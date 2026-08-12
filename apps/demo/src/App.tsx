import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { canonicalHash, validateWorkspace } from "@panefold/kernel";
import { solveLayout } from "@panefold/geometry";
import {
  getEntity,
  nodeId,
  type CommittedTransaction,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";
import {
  WorkspaceRuntimeProvider,
  WorkspaceSurface,
  useWorkspaceSnapshot,
  useWorkspaceTransactions,
  type WorkspaceDirection,
  type WorkspaceLayoutSolver,
  type WorkspaceProjection,
  type WorkspaceTabContent,
  type WorkspaceTabPlacement,
} from "@panefold/react";
import type {
  DurableWorkspaceStatus,
  RuntimeDispatchReceipt,
  WorkspaceRuntime,
} from "@panefold/runtime";

import { demoPanelRegistry, Glyph, heavyContentDemoPanelRegistry } from "./demo-panels";
import { DemoExternalPanelController } from "./external-panels";
import { createRedactedReproduction } from "./reproduction";
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
import { createDemoCommands, initialWorkspaceSnapshot, projectWorkspace } from "./workspace-config";

type InspectorTab = "topology" | "transactions" | "focus";

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
      <MapWorkspaceApp session={bootstrap.session} />
    </WorkspaceRuntimeProvider>
  );
}

function MapWorkspaceApp({ session }: { readonly session: DemoWorkspaceSession }) {
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
  const [compactGroupId, setCompactGroupId] = useState("primary");
  const [surfaceStatus, setSurfaceStatus] = useState(
    "Drag a tab to another group, an edge, or beyond the workspace",
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

  return (
    <div className="demo-app" data-theme={theme} dir={direction}>
      <header className="demo-topbar">
        <a className="demo-brand" href="/" aria-label="Panefold home">
          <span className="demo-brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            <strong>Panefold</strong>
            <small>Workspace Runtime</small>
          </span>
        </a>
        <span className="demo-topbar-divider" aria-hidden="true" />
        <div className="demo-workspace-title">
          <span className="demo-workspace-dot" aria-hidden="true" />
          <span>
            <strong>One-North route review</strong>
            <small>Atlas Operations · RA-042 · Singapore</small>
          </span>
        </div>
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
          label="Open command palette"
          onClick={() => {
            setPaletteOpen(true);
          }}
        >
          <span className="demo-command-key">⌘K</span>
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
              setSurfaceStatus("Saved layout reset to the Atlas starting workspace");
            });
          }}
        />
      </header>

      <main className="demo-main" ref={workspaceFrameRef}>
        <WorkspaceSurface
          projector={projector}
          commands={commands}
          panels={panelRegistry}
          layoutSolver={layoutSolver}
          direction={direction}
          motion={motion}
          workspaceLabel="Map operations workspace"
          className="demo-workspace"
          responsive="auto"
          compactGroupId={compactGroupId}
          onCompactGroupChange={setCompactGroupId}
          tabPresentation={{ placement: tabPlacement, content: tabContent }}
          onExternalPanelRequest={externalPanels.handleRequest}
        />
        {inspectorOpen ? (
          <WorkspaceInspector
            runtime={runtime}
            onClose={() => {
              setInspectorOpen(false);
            }}
          />
        ) : null}
      </main>

      <footer className="demo-statusbar">
        <span
          className="demo-health"
          data-valid={String(invariantViolations.length === 0)}
          title={invariantViolations.map((violation) => violation.message).join("\n")}
        >
          <i aria-hidden="true" />
          {invariantViolations.length === 0
            ? "Kernel valid"
            : `${invariantViolations.length} invariant ${
                invariantViolations.length === 1 ? "violation" : "violations"
              }`}
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
        <span className="demo-toolbar-spacer" />
        <span className="demo-status-active">Active: {activePanel?.title ?? "None"}</span>
        <span className="demo-status-projection">Responsive projection</span>
        <span className="demo-status-motion">{motion} motion</span>
        <span className="demo-surface-status" role="status">
          {surfaceStatus}
        </span>
        <span className="demo-status-lifecycle">Stable hosts · hidden work suspends</span>
        <PersistenceBadge
          snapshot={snapshot}
          status={persistenceStatus}
          restoration={session.restoration}
          changedSinceRestore={changedSinceRestore}
        />
      </footer>

      {paletteOpen ? (
        <CommandPalette
          runtime={runtime}
          snapshot={snapshot}
          onClose={() => {
            setPaletteOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function WorkspaceBootstrap() {
  return (
    <main className="demo-bootstrap" aria-busy="true" aria-label="Opening Atlas workspace">
      <span className="demo-brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <div>
        <strong>Opening Atlas</strong>
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

function WorkspaceInspector({
  runtime,
  onClose,
}: {
  readonly runtime: WorkspaceRuntime;
  readonly onClose: () => void;
}) {
  const snapshot = useWorkspaceSnapshot<
    WorkspaceSnapshot,
    WorkspaceCommand,
    RuntimeDispatchReceipt
  >();
  const transactions = useWorkspaceTransactions<
    WorkspaceSnapshot,
    WorkspaceCommand,
    RuntimeDispatchReceipt
  >() as readonly CommittedTransaction[];
  const [tab, setTab] = useState<InspectorTab>("topology");

  return (
    <aside className="demo-inspector" aria-label="Workspace inspector">
      <header>
        <div>
          <span className="demo-kicker">Developer tools</span>
          <strong>Workspace inspector</strong>
        </div>
        <button type="button" aria-label="Close workspace inspector" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="demo-inspector-tabs" role="tablist" aria-label="Inspector views">
        {(["topology", "transactions", "focus"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => {
              setTab(value);
            }}
          >
            {value[0]?.toUpperCase()}
            {value.slice(1)}
          </button>
        ))}
      </div>
      <div className="demo-inspector-content">
        {tab === "topology" ? <TopologyInspector snapshot={snapshot} /> : null}
        {tab === "transactions" ? <TransactionInspector transactions={transactions} /> : null}
        {tab === "focus" ? <FocusInspector snapshot={snapshot} /> : null}
      </div>
      <footer>
        <button
          type="button"
          onClick={() => {
            void copyReproduction(runtime);
          }}
        >
          Copy redacted reproduction
        </button>
        <span>Observational only</span>
      </footer>
    </aside>
  );
}

function TopologyInspector({ snapshot }: { readonly snapshot: WorkspaceSnapshot }) {
  const roots = snapshot.surfaces.ids
    .map((id) => getEntity(snapshot.surfaces, id))
    .filter((item) => item !== undefined);
  return (
    <div className="demo-inspector-section">
      <InspectorMetric label="Revision" value={snapshot.revision.toString()} />
      <InspectorMetric label="Canonical hash" value={canonicalHash(snapshot)} />
      <h3>Surface roots</h3>
      {roots.map((surface) => (
        <div key={surface.id} className="demo-inspector-card">
          <span className="demo-plane-badge plane-semantic">{surface.kind}</span>
          <strong>{surface.id}</strong>
          <code>root → {surface.rootNodeId}</code>
        </div>
      ))}
      <h3>Layout tree</h3>
      <ul className="demo-topology-tree">
        {snapshot.nodes.ids.map((id) => {
          const node = getEntity(snapshot.nodes, id);
          if (node === undefined) return null;
          return (
            <li key={id}>
              <span>{node.kind === "split" ? "◇" : "▣"}</span>
              <div>
                <strong>{node.id}</strong>
                <small>
                  {node.kind === "split"
                    ? `${node.axis} · ${node.weights.join(" / ")}`
                    : `group → ${node.groupId}`}
                </small>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TransactionInspector({
  transactions,
}: {
  readonly transactions: readonly CommittedTransaction[];
}) {
  return (
    <div className="demo-inspector-section">
      <InspectorMetric label="Committed" value={String(transactions.length)} />
      <h3>Latest transactions</h3>
      {transactions.length === 0 ? (
        <p className="demo-muted">
          Resize a pane, select a tab, or move a panel to see atomic transactions.
        </p>
      ) : (
        <ol className="demo-transaction-list">
          {[...transactions]
            .reverse()
            .slice(0, 20)
            .map((transaction) => (
              <li key={transaction.id}>
                <span className={`demo-origin origin-${transaction.origin}`}>
                  {transaction.origin}
                </span>
                <div>
                  <strong>{transaction.label}</strong>
                  <small>
                    rev {transaction.previousRevision.toString()} →{" "}
                    {transaction.revision.toString()} · {transaction.patches.length} patches
                  </small>
                </div>
              </li>
            ))}
        </ol>
      )}
    </div>
  );
}

function FocusInspector({ snapshot }: { readonly snapshot: WorkspaceSnapshot }) {
  const activePanel =
    snapshot.activation.activePanelId === undefined
      ? undefined
      : getEntity(snapshot.panels, snapshot.activation.activePanelId);
  return (
    <div className="demo-inspector-section">
      <h3>Semantic focus state</h3>
      <div className="demo-focus-flow">
        <span>Selected per group</span>
        <i>→</i>
        <span className="current">{activePanel?.title ?? "No active panel"}</span>
        <i>→</i>
        <span>DOM descendant</span>
      </div>
      <dl className="demo-inspector-dl">
        <div>
          <dt>Active panel</dt>
          <dd>{activePanel?.id ?? "—"}</dd>
        </div>
        <div>
          <dt>Active surface</dt>
          <dd>{snapshot.activation.activeSurfaceId ?? "—"}</dd>
        </div>
        <div>
          <dt>Focus fallback</dt>
          <dd>{snapshot.focusMemory.fallback}</dd>
        </div>
        <div>
          <dt>Restoration token</dt>
          <dd>{snapshot.focusMemory.restorationToken ?? "not supplied"}</dd>
        </div>
      </dl>
      <h3>Selected panels</h3>
      {snapshot.groups.ids.map((id) => {
        const group = getEntity(snapshot.groups, id);
        return group === undefined ? null : (
          <div key={id} className="demo-inspector-card">
            <strong>{group.region ?? group.id}</strong>
            <code>{group.selectedPanelId}</code>
          </div>
        );
      })}
    </div>
  );
}

function InspectorMetric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="demo-inspector-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CommandPalette({
  runtime,
  snapshot,
  onClose,
}: {
  readonly runtime: WorkspaceRuntime;
  readonly snapshot: WorkspaceSnapshot;
  readonly onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const panels = snapshot.panels.ids
    .map((id) => getEntity(snapshot.panels, id))
    .filter((item) => item !== undefined);
  const matches = panels.filter((panel) =>
    (panel.title ?? panel.type).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div
      className="demo-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="demo-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Workspace command palette"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <label>
          <span aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Find a panel or command…"
          />
        </label>
        <div className="demo-command-results">
          <p>Panels</p>
          {matches.map((panel) => (
            <button
              key={panel.id}
              type="button"
              onClick={() => {
                runtime.dispatch(
                  { type: "select-panel", panelId: panel.id, activate: true },
                  { origin: "menu", label: `Selected ${panel.title ?? panel.type}` },
                );
                onClose();
              }}
            >
              <span className="demo-command-icon">
                <Glyph name={glyphForPanel(panel.type)} />
              </span>
              <span>
                <strong>{panel.title ?? panel.type}</strong>
                <small>Focus panel</small>
              </span>
              <kbd>Enter</kbd>
            </button>
          ))}
          <p>Workspace</p>
          <button
            type="button"
            disabled={!runtime.canUndo()}
            onClick={() => {
              runtime.undo();
              onClose();
            }}
          >
            <span className="demo-command-icon">↶</span>
            <span>
              <strong>Undo layout change</strong>
              <small>Restore the previous canonical arrangement</small>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              runtime.dispatch(
                { type: "restore-workspace", snapshot: initialWorkspaceSnapshot },
                { origin: "restore", label: "Restore map operations preset" },
              );
              onClose();
            }}
          >
            <span className="demo-command-icon">⌂</span>
            <span>
              <strong>Restore map operations preset</strong>
              <small>Return to the initial four-region layout</small>
            </span>
          </button>
        </div>
        <footer>
          <span>
            <kbd>Tab</kbd> Navigate
          </span>
          <span>
            <kbd>Esc</kbd> Close
          </span>
        </footer>
      </section>
    </div>
  );
}

function glyphForPanel(type: string): Parameters<typeof Glyph>[0]["name"] {
  if (type.includes("route")) return "route";
  if (type.includes("layers")) return "layers";
  if (type.includes("canvas")) return "map";
  if (type.includes("notes")) return "notes";
  if (type.includes("inspector")) return "inspect";
  if (type.includes("validation")) return "validate";
  if (type.includes("problems")) return "problems";
  return "timeline";
}

async function copyReproduction(runtime: WorkspaceRuntime) {
  const reproduction = createRedactedReproduction(runtime, document.dir || "ltr");
  await navigator.clipboard.writeText(JSON.stringify(reproduction, null, 2));
}
