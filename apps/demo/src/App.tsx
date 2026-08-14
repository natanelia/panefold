import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { validateWorkspace } from "@panefold/kernel";
import { solveLayout } from "@panefold/geometry";
import {
  getEntity,
  nodeId,
  panelId,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";
import {
  WorkspaceRuntimeProvider,
  WorkspaceSurface,
  useWorkspaceSnapshot,
  type WorkspaceDirection,
  type WorkspaceLayoutSolver,
  type WorkspaceProjection,
  type WorkspaceTabContent,
  type WorkspaceTabPlacement,
} from "@panefold/react";
import type { DurableWorkspaceStatus, RuntimeDispatchReceipt } from "@panefold/runtime";

import { demoPanelRegistry, heavyContentDemoPanelRegistry } from "./demo-panels";
import { DemoExternalPanelController } from "./external-panels";
import {
  createDemoWorkspaceFailureResult,
  openDemoWorkspaceSession,
  type DemoWorkspaceRestoration,
  type DemoWorkspaceSession,
  type OpenDemoWorkspaceSessionResult,
} from "./runtime-session";
import {
  readDemoViewPreferences,
  writeDemoViewPreferences,
  type DemoMotionProfile,
  type DemoTheme,
  type DemoViewPreferences,
} from "./view-preferences";
import { createDemoCommands, projectWorkspace } from "./workspace-config";

const LazyWorkspaceInspector = lazy(async () => {
  const module = await import("./optional-tools");
  return { default: module.WorkspaceInspector };
});

const LazyCommandPalette = lazy(async () => {
  const module = await import("./optional-tools");
  return { default: module.CommandPalette };
});

const marketingHomeUrl = new URL("../", document.baseURI).href;

const applicationMenuItems = [
  "File",
  "Edit",
  "Selection",
  "View",
  "Go",
  "Run",
  "Terminal",
  "Help",
] as const;

type WorkbenchIconName =
  "account" | "branch" | "explorer" | "manage" | "problems" | "search" | "source" | "terminal";

const activityItems = [
  { icon: "explorer", label: "Explorer", panelId: "route-explorer" },
  { icon: "search", label: "Search", panelId: "layers" },
  { icon: "source", label: "Source Control", panelId: "validation" },
  { icon: "terminal", label: "Terminal", panelId: "problems" },
  { icon: "problems", label: "Problems", panelId: "timeline" },
] as const satisfies readonly {
  readonly icon: WorkbenchIconName;
  readonly label: string;
  readonly panelId: string;
}[];

type BootstrapState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly session: DemoWorkspaceSession }
  | {
      readonly status: "failed";
      readonly result: Extract<OpenDemoWorkspaceSessionResult, { readonly ok: false }>;
    };

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    let session: DemoWorkspaceSession | undefined;
    void openDemoWorkspaceSession()
      .then((result) => {
        if (!active) {
          if (result.ok) void result.session.dispose().catch(() => undefined);
          return;
        }
        if (result.ok) {
          session = result.session;
          setBootstrap({ status: "ready", session });
        } else {
          setBootstrap({ status: "failed", result });
        }
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setBootstrap({
          status: "failed",
          result: createDemoWorkspaceFailureResult(cause),
        });
      });
    return () => {
      active = false;
      if (session !== undefined) void session.dispose().catch(() => undefined);
    };
  }, []);

  if (bootstrap.status === "loading") return <WorkspaceBootstrap />;
  if (bootstrap.status === "failed") return <WorkspaceRecoveryFailure result={bootstrap.result} />;

  return (
    <WorkspaceRuntimeProvider runtime={bootstrap.session.runtime}>
      <CodeWorkspaceApp session={bootstrap.session} />
    </WorkspaceRuntimeProvider>
  );
}

function CodeWorkspaceApp({ session }: { readonly session: DemoWorkspaceSession }) {
  const runtime = session.runtime;
  const snapshot = useWorkspaceSnapshot<
    WorkspaceSnapshot,
    WorkspaceCommand,
    RuntimeDispatchReceipt
  >();
  const [preferences, setPreferences] = useState<DemoViewPreferences>(readDemoViewPreferences);
  const { theme, direction, motion, tabPlacement, tabContent } = preferences;
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [activeActivityPanelId, setActiveActivityPanelId] = useState("route-explorer");
  const [compactGroupId, setCompactGroupId] = useState("primary");
  const [surfaceStatus, setSurfaceStatus] = useState(
    "Drag a tab to reorder, dock, split, or open it beyond the workspace",
  );
  const [persistenceStatus, setPersistenceStatus] = useState(() => session.durable.getStatus());
  const [changedSinceRestore, setChangedSinceRestore] = useState(false);
  const panelRegistry = useMemo(
    () =>
      new URL(window.location.href).searchParams.get("fixture") === "heavy"
        ? heavyContentDemoPanelRegistry
        : demoPanelRegistry,
    [],
  );
  const workspaceFrameRef = useRef<HTMLDivElement>(null);

  const updatePreferences = useCallback((patch: Partial<DemoViewPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      writeDemoViewPreferences(next);
      return next;
    });
  }, []);

  const commands = useMemo(() => createDemoCommands(() => runtime.getSnapshot()), [runtime]);
  const externalPanels = useMemo(
    () =>
      new DemoExternalPanelController({
        runtime,
        // Preferences are synchronously mirrored to local storage by the
        // controls below. Reading that application-owned view state lazily
        // keeps popup creation current without making a React ref part of the
        // render path.
        getTheme: () => readDemoViewPreferences().theme,
        getDirection: () => readDemoViewPreferences().direction,
        onStatus: setSurfaceStatus,
      }),
    [runtime],
  );

  useEffect(
    () => session.registerBeforeDispose(() => externalPanels.returnAll()),
    [externalPanels, session],
  );

  useEffect(
    () =>
      session.durable.subscribeStatus((status) => {
        setPersistenceStatus(status);
      }),
    [session],
  );

  useEffect(
    () =>
      runtime.subscribeTransactions(() => {
        setChangedSinceRestore(true);
      }),
    [runtime],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      setPaletteOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const projector = useCallback(
    (nextSnapshot: WorkspaceSnapshot): WorkspaceProjection => projectWorkspace(nextSnapshot),
    [],
  );
  const layoutSolver = useCallback<WorkspaceLayoutSolver<WorkspaceSnapshot>>(
    (layoutSnapshot, request) =>
      solveLayout(layoutSnapshot, nodeId(request.rootNodeId), request.bounds, {
        splitterSize: request.splitterSize,
        splitOverrides: request.splitOverrides,
      }),
    [],
  );

  const activePanel =
    snapshot.activation.activePanelId === undefined
      ? undefined
      : getEntity(snapshot.panels, snapshot.activation.activePanelId);
  const canUndo = runtime.canUndo();
  const canRedo = runtime.canRedo();
  const invariantViolations = useMemo(() => validateWorkspace(snapshot), [snapshot]);

  const activateWorkbenchPanel = (id: string, label: string) => {
    if (getEntity(snapshot.panels, panelId(id)) === undefined) {
      setSurfaceStatus(`${label} is closed. Undo the layout change to restore it.`);
      return;
    }
    runtime.dispatch(
      { type: "select-panel", panelId: panelId(id), activate: true },
      { origin: "menu", label: `Show ${label}` },
    );
    setActiveActivityPanelId(id);
    setSurfaceStatus(`${label} focused`);
  };

  const handleApplicationMenu = (item: (typeof applicationMenuItems)[number]) => {
    if (item === "Edit") {
      if (runtime.canUndo()) runtime.undo();
      else setSurfaceStatus("Nothing to undo");
      return;
    }
    if (item === "View") {
      setInspectorOpen((value) => !value);
      return;
    }
    if (item === "Run" || item === "Terminal") {
      activateWorkbenchPanel("problems", "Terminal");
      return;
    }
    if (item === "Help") {
      setSurfaceStatus("Panefold Code · deterministic workspace runtime demo");
      return;
    }
    setPaletteOpen(true);
  };

  return (
    <div className="demo-app" data-theme={theme} dir={direction}>
      <h1 className="demo-visually-hidden">Panefold Code workbench</h1>
      <header className="demo-topbar">
        <a className="demo-brand" href={marketingHomeUrl} aria-label="Panefold home">
          <span className="demo-brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <strong>Panefold Code</strong>
        </a>
        <nav className="demo-menu" aria-label="Application menu">
          {applicationMenuItems.map((item) => (
            <button
              type="button"
              key={item}
              title={`${item} menu`}
              onClick={() => {
                handleApplicationMenu(item);
              }}
            >
              {item}
            </button>
          ))}
        </nav>
        <button
          className="demo-command-center"
          type="button"
          aria-label="Open Command Palette"
          onClick={() => {
            setPaletteOpen(true);
          }}
        >
          <WorkbenchIcon name="search" />
          <span>panefold-demo</span>
          <kbd>⌘K</kbd>
        </button>
        <span className="demo-toolbar-spacer" />
        <ToolbarButton
          label="Undo layout change"
          disabled={!canUndo}
          onClick={() => {
            runtime.undo();
          }}
        >
          ↶
        </ToolbarButton>
        <ToolbarButton
          label="Redo layout change"
          disabled={!canRedo}
          onClick={() => {
            runtime.redo();
          }}
        >
          ↷
        </ToolbarButton>
        <ToolbarButton
          label={inspectorOpen ? "Close workspace inspector" : "Open workspace inspector"}
          pressed={inspectorOpen}
          onClick={() => {
            setInspectorOpen((value) => !value);
          }}
        >
          ◫
        </ToolbarButton>
        <SettingsMenu
          theme={theme}
          direction={direction}
          motion={motion}
          tabPlacement={tabPlacement}
          tabContent={tabContent}
          onTheme={(value) => {
            updatePreferences({ theme: value });
          }}
          onDirection={(value) => {
            updatePreferences({ direction: value });
          }}
          onMotion={(value) => {
            updatePreferences({ motion: value });
          }}
          onTabPlacement={(value) => {
            updatePreferences({ tabPlacement: value });
          }}
          onTabContent={(value) => {
            updatePreferences({ tabContent: value });
          }}
          onResetLayout={() => {
            void session.resetLayout().then(() => {
              setSurfaceStatus("Saved layout reset to the Panefold Code workspace");
            });
          }}
        />
      </header>

      <main className="demo-main" ref={workspaceFrameRef}>
        <aside className="demo-activity-bar" aria-label="Activity bar">
          {activityItems.map((item) => {
            const active = activeActivityPanelId === item.panelId;
            const available = getEntity(snapshot.panels, panelId(item.panelId)) !== undefined;
            return (
              <button
                type="button"
                key={item.label}
                aria-label={item.label}
                aria-pressed={active}
                title={available ? item.label : `${item.label} (closed)`}
                disabled={!available}
                onClick={() => {
                  activateWorkbenchPanel(item.panelId, item.label);
                }}
              >
                <WorkbenchIcon name={item.icon} />
              </button>
            );
          })}
          <span className="demo-activity-spacer" />
          <button
            type="button"
            aria-label="Accounts"
            aria-pressed={inspectorOpen}
            title="Accounts and runtime inspector"
            onClick={() => {
              setInspectorOpen((value) => !value);
            }}
          >
            <WorkbenchIcon name="account" />
          </button>
          <button
            type="button"
            aria-label="Manage"
            title="Manage workbench"
            onClick={() => {
              setPaletteOpen(true);
            }}
          >
            <WorkbenchIcon name="manage" />
          </button>
        </aside>
        <WorkspaceSurface
          projector={projector}
          commands={commands}
          panels={panelRegistry}
          layoutSolver={layoutSolver}
          direction={direction}
          motion={motion}
          workspaceLabel="Panefold Code workbench"
          className="demo-workspace"
          responsive="auto"
          compactGroupId={compactGroupId}
          onCompactGroupChange={setCompactGroupId}
          tabPresentation={{ placement: tabPlacement, content: tabContent }}
          onExternalPanelRequest={externalPanels.handleRequest}
        />
        {inspectorOpen ? (
          <DeferredToolBoundary
            label="Workspace inspector"
            onClose={() => {
              setInspectorOpen(false);
            }}
          >
            <Suspense fallback={<ToolLoading label="Loading workspace inspector…" />}>
              <LazyWorkspaceInspector
                runtime={runtime}
                onClose={() => {
                  setInspectorOpen(false);
                }}
              />
            </Suspense>
          </DeferredToolBoundary>
        ) : null}
      </main>

      <footer className="demo-statusbar">
        <span className="demo-status-remote" title="Open a remote window by dragging a tab out">
          <span aria-hidden="true">›‹</span>
        </span>
        <span
          className="demo-health"
          data-valid={String(invariantViolations.length === 0)}
          title={
            invariantViolations.length === 0
              ? "Kernel valid · main branch"
              : invariantViolations.map((violation) => violation.message).join("\n")
          }
        >
          <WorkbenchIcon name="branch" />
          {invariantViolations.length === 0
            ? "main"
            : `${invariantViolations.length} invariant ${
                invariantViolations.length === 1 ? "violation" : "violations"
              }`}
        </span>
        <span className="demo-status-problems" title="Problems">
          <span aria-hidden="true">⊗</span> 1&nbsp;&nbsp;<span aria-hidden="true">△</span> 1
        </span>
        <span
          className="demo-status-revision"
          data-workspace-revision={snapshot.revision.toString()}
        >
          Revision {snapshot.revision.toString()}
        </span>
        <span className="demo-status-topology">
          {snapshot.panels.ids.length} panels · {snapshot.groups.ids.length} groups
        </span>
        <span className="demo-surface-status" role="status">
          {surfaceStatus}
        </span>
        <span className="demo-toolbar-spacer" />
        <span className="demo-status-active">Active: {activePanel?.title ?? "None"}</span>
        <span className="demo-status-position">Ln 8, Col 24</span>
        <span className="demo-status-encoding">UTF-8</span>
        <span className="demo-status-indent">Spaces: 2</span>
        <span className="demo-status-language">{"{ }"} TypeScript React</span>
        <PersistenceBadge
          snapshot={snapshot}
          status={persistenceStatus}
          restoration={session.restoration}
          changedSinceRestore={changedSinceRestore}
        />
      </footer>

      {paletteOpen ? (
        <DeferredToolBoundary
          label="Command palette"
          modal
          onClose={() => {
            setPaletteOpen(false);
          }}
        >
          <Suspense fallback={<ToolLoading label="Loading command palette…" modal />}>
            <LazyCommandPalette
              runtime={runtime}
              snapshot={snapshot}
              onClose={() => {
                setPaletteOpen(false);
              }}
            />
          </Suspense>
        </DeferredToolBoundary>
      ) : null}
    </div>
  );
}

function ToolLoading({
  label,
  modal = false,
}: {
  readonly label: string;
  readonly modal?: boolean;
}) {
  const status = (
    <div
      className={
        modal ? "demo-command-palette demo-tool-loading" : "demo-inspector demo-tool-loading"
      }
      role="status"
      aria-busy="true"
    >
      <span className="demo-brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <strong>{label}</strong>
    </div>
  );
  return modal ? <div className="demo-dialog-backdrop">{status}</div> : status;
}

class DeferredToolBoundary extends Component<
  {
    readonly children: ReactNode;
    readonly label: string;
    readonly modal?: boolean;
    readonly onClose: () => void;
  },
  { readonly failed: boolean }
> {
  public override state = { failed: false };

  public static getDerivedStateFromError() {
    return { failed: true };
  }

  public override render() {
    if (!this.state.failed) return this.props.children;
    const failure = (
      <div
        className={
          this.props.modal
            ? "demo-command-palette demo-tool-loading"
            : "demo-inspector demo-tool-loading"
        }
        role="alert"
      >
        <strong>{this.props.label} could not be loaded.</strong>
        <button type="button" onClick={this.props.onClose}>
          Close
        </button>
      </div>
    );
    return this.props.modal ? <div className="demo-dialog-backdrop">{failure}</div> : failure;
  }
}

function WorkspaceBootstrap() {
  return (
    <main className="demo-bootstrap" aria-busy="true" aria-label="Opening Panefold Code workspace">
      <span className="demo-brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <div>
        <strong>Opening Panefold Code</strong>
        <span>Checking the saved workspace before first render…</span>
      </div>
    </main>
  );
}

function WorkspaceRecoveryFailure({
  result,
}: {
  readonly result: Extract<OpenDemoWorkspaceSessionResult, { readonly ok: false }>;
}) {
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string>();
  return (
    <main className="demo-bootstrap demo-recovery-failure">
      <span className="demo-kicker">Safe recovery boundary</span>
      <h1>The saved workspace was not overwritten.</h1>
      <p>{result.error.message}</p>
      {result.diagnostics.length === 0 ? null : (
        <ul>
          {result.diagnostics.map((diagnostic) => (
            <li key={`${diagnostic.code}:${diagnostic.message}`}>
              <strong>{diagnostic.code}</strong> {diagnostic.message}
            </li>
          ))}
        </ul>
      )}
      {resetError === undefined ? null : <p role="alert">Reset failed: {resetError}</p>}
      <button
        type="button"
        disabled={resetting}
        onClick={() => {
          setResetting(true);
          setResetError(undefined);
          void result.reset().then(
            () => window.location.reload(),
            (cause: unknown) => {
              setResetting(false);
              setResetError(cause instanceof Error ? cause.message : "IndexedDB reset failed");
            },
          );
        }}
      >
        {resetting ? "Resetting…" : "Discard saved data and open the default layout"}
      </button>
    </main>
  );
}

function PersistenceBadge({
  snapshot,
  status,
  restoration,
  changedSinceRestore,
}: {
  readonly snapshot: WorkspaceSnapshot;
  readonly status: DurableWorkspaceStatus;
  readonly restoration: DemoWorkspaceRestoration;
  readonly changedSinceRestore: boolean;
}) {
  let state = "saved";
  let label: string;
  if (status.degraded) {
    state = "degraded";
    label = "IndexedDB unavailable · layout remains safe in memory";
  } else if (status.pendingWrites > 0) {
    state = "saving";
    label = `Saving revision ${snapshot.revision.toString()} to IndexedDB…`;
  } else if (restoration.status === "restored" && !changedSinceRestore) {
    state = "restored";
    label = `Restored revision ${restoration.revision} from IndexedDB`;
    if (restoration.recoveredExternalSurfaces > 0) {
      label += ` · recovered ${String(restoration.recoveredExternalSurfaces)} external ${
        restoration.recoveredExternalSurfaces === 1 ? "surface" : "surfaces"
      } · saved revision ${status.lastPersistedRevision ?? snapshot.revision.toString()}`;
    }
  } else {
    label = `Saved revision ${status.lastPersistedRevision ?? snapshot.revision.toString()} in IndexedDB`;
  }
  return (
    <span
      className="demo-persistence-status"
      role="status"
      data-persistence-state={state}
      data-persisted-revision={status.lastPersistedRevision ?? ""}
      title="Canonical layout snapshots and semantic transactions use the checksummed Panefold journal. Panel-owned document content requires its own checkpoint codec."
    >
      <i aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

function WorkbenchIcon({ name }: { readonly name: WorkbenchIconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.55,
  };
  const paths: Record<WorkbenchIconName, ReactNode> = {
    account: (
      <>
        <circle cx="12" cy="8" r="3.25" {...common} />
        <path d="M5.5 20c.8-3.5 3-5.25 6.5-5.25s5.7 1.75 6.5 5.25" {...common} />
      </>
    ),
    branch: (
      <>
        <circle cx="7" cy="5" r="2" {...common} />
        <circle cx="17" cy="7" r="2" {...common} />
        <circle cx="7" cy="19" r="2" {...common} />
        <path d="M7 7v10M9 8.5c4.8 0 3.2-1.5 6-1.5" {...common} />
      </>
    ),
    terminal: (
      <>
        <path d="m5 7 4 4-4 4M11 16h7" {...common} />
        <rect x="3" y="4" width="18" height="16" rx="2" {...common} />
      </>
    ),
    explorer: (
      <>
        <path d="M6.5 3.5h8l3 3v10h-11v-13Z" {...common} />
        <path d="M14.5 3.5v3h3M3.5 7.5v13h11" {...common} />
      </>
    ),
    manage: (
      <>
        <circle cx="12" cy="12" r="3" {...common} />
        <path
          d="m9.6 3.7.7-1.7h3.4l.7 1.7 1.6.9 1.8-.2 1.7 3-1.1 1.4v1.8l1.1 1.4-1.7 3-1.8-.2-1.6.9-.7 1.7h-3.4l-.7-1.7-1.6-.9-1.8.2-1.7-3 1.1-1.4V8.8L4.5 7.4l1.7-3 1.8.2 1.6-.9Z"
          {...common}
        />
      </>
    ),
    problems: (
      <>
        <path d="M12 3.5 21 20H3L12 3.5Z" {...common} />
        <path d="M12 9v5M12 17v.2" {...common} />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6" {...common} />
        <path d="m15 15 5 5" {...common} />
      </>
    ),
    source: (
      <>
        <circle cx="7" cy="5" r="2" {...common} />
        <circle cx="17" cy="7" r="2" {...common} />
        <circle cx="7" cy="19" r="2" {...common} />
        <path d="M7 7v10M9 18c6 0 8-3.5 8-9" {...common} />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function ToolbarButton({
  label,
  children,
  disabled,
  pressed,
  onClick,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      className="demo-topbar-button"
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SettingsMenu({
  theme,
  direction,
  motion,
  tabPlacement,
  tabContent,
  onTheme,
  onDirection,
  onMotion,
  onTabPlacement,
  onTabContent,
  onResetLayout,
}: {
  readonly theme: DemoTheme;
  readonly direction: WorkspaceDirection;
  readonly motion: DemoMotionProfile;
  readonly tabPlacement: WorkspaceTabPlacement;
  readonly tabContent: WorkspaceTabContent;
  readonly onTheme: (value: DemoTheme) => void;
  readonly onDirection: (value: WorkspaceDirection) => void;
  readonly onMotion: (value: DemoMotionProfile) => void;
  readonly onTabPlacement: (value: WorkspaceTabPlacement) => void;
  readonly onTabContent: (value: WorkspaceTabContent) => void;
  readonly onResetLayout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node) !== true) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="demo-settings" ref={menuRef}>
      <ToolbarButton
        label="Workspace appearance"
        pressed={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        ⚙
      </ToolbarButton>
      {open ? (
        <div className="demo-settings-popover" role="dialog" aria-label="Workspace appearance">
          <label>
            Theme
            <select
              value={theme}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                onTheme(event.target.value as DemoTheme);
              }}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <label>
            Direction
            <select
              value={direction}
              onChange={(event) => {
                onDirection(event.target.value as WorkspaceDirection);
              }}
            >
              <option value="ltr">Left to right</option>
              <option value="rtl">Right to left</option>
            </select>
          </label>
          <label>
            Tab rail
            <select
              value={tabPlacement}
              onChange={(event) => {
                onTabPlacement(event.target.value as WorkspaceTabPlacement);
              }}
            >
              <option value="block-start">Top · horizontal</option>
              <option value="block-end">Bottom · horizontal</option>
              <option value="inline-start">Leading · vertical</option>
              <option value="inline-end">Trailing · vertical</option>
            </select>
          </label>
          <label>
            Tab labels
            <select
              value={tabContent}
              onChange={(event) => {
                onTabContent(event.target.value as WorkspaceTabContent);
              }}
            >
              <option value="icon-and-label">Icon and label</option>
              <option value="icon-only">Icons only</option>
              <option value="label-only">Labels only</option>
            </select>
          </label>
          <fieldset>
            <legend>Motion</legend>
            {(["productive", "reduced", "off"] as const).map((profile) => (
              <label key={profile}>
                <input
                  type="radio"
                  name="motion"
                  checked={motion === profile}
                  onChange={() => {
                    onMotion(profile);
                  }}
                />
                {profile[0]?.toUpperCase()}
                {profile.slice(1)}
              </label>
            ))}
          </fieldset>
          <button className="demo-settings-reset" type="button" onClick={onResetLayout}>
            Reset saved layout
          </button>
        </div>
      ) : null}
    </div>
  );
}
