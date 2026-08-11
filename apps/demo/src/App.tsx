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
import {
  getEntity,
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
  type WorkspaceProjection,
} from "@panefold/react";
import {
  createWorkspaceRuntime,
  type RuntimeDispatchReceipt,
  type WorkspaceRuntime,
} from "@panefold/runtime";

import { demoPanelRegistry, Glyph } from "./demo-panels";
import { demoCommands, initialWorkspaceSnapshot, projectWorkspace } from "./workspace-config";

type Theme = "dark" | "light";
type MotionProfile = "off" | "reduced" | "productive";
type InspectorTab = "topology" | "transactions" | "focus";

export default function App() {
  const runtime = useMemo(
    () =>
      createWorkspaceRuntime({
        initialSnapshot: initialWorkspaceSnapshot,
        historyLimit: 200,
        transactionLimit: 100,
      }),
    [],
  );

  useEffect(
    () => () => {
      runtime.dispose();
    },
    [runtime],
  );

  return (
    <WorkspaceRuntimeProvider runtime={runtime}>
      <MapWorkspaceApp runtime={runtime} />
    </WorkspaceRuntimeProvider>
  );
}

function MapWorkspaceApp({ runtime }: { readonly runtime: WorkspaceRuntime }) {
  const snapshot = useWorkspaceSnapshot<
    WorkspaceSnapshot,
    WorkspaceCommand,
    RuntimeDispatchReceipt
  >();
  const [theme, setTheme] = useState<Theme>("dark");
  const [direction, setDirection] = useState<WorkspaceDirection>("ltr");
  const [motion, setMotion] = useState<MotionProfile>("productive");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [compactGroupId, setCompactGroupId] = useState("primary");
  const workspaceFrameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = workspaceFrameRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setCompact(entry.contentRect.width < 720);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

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
    (nextSnapshot: WorkspaceSnapshot): WorkspaceProjection => {
      const projection = projectWorkspace(nextSnapshot);
      if (!compact) return projection;
      const groupNode = Object.values(projection.nodes).find(
        (node) => node.kind === "group" && node.groupId === compactGroupId,
      );
      return groupNode === undefined ? projection : { ...projection, rootNodeId: groupNode.id };
    },
    [compact, compactGroupId],
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
            <small>RA-042 · Singapore</small>
          </span>
        </div>
        <span className="demo-toolbar-spacer" />
        {compact ? (
          <label className="demo-compact-group">
            <span>Region</span>
            <select
              value={compactGroupId}
              onChange={(event) => {
                setCompactGroupId(event.target.value);
              }}
            >
              <option value="navigation">Navigation</option>
              <option value="primary">Primary</option>
              <option value="inspector">Inspector</option>
              <option value="output">Output</option>
            </select>
          </label>
        ) : null}
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
          onTheme={setTheme}
          onDirection={setDirection}
          onMotion={setMotion}
        />
      </header>

      <main className="demo-main" ref={workspaceFrameRef}>
        <WorkspaceSurface
          projector={projector}
          commands={demoCommands}
          panels={demoPanelRegistry}
          direction={direction}
          motion={motion}
          workspaceLabel="Map operations workspace"
          className="demo-workspace"
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
        <span>Revision {snapshot.revision.toString()}</span>
        <span>
          {snapshot.panels.ids.length} panels · {snapshot.groups.ids.length} groups
        </span>
        <span className="demo-toolbar-spacer" />
        <span>Active: {activePanel?.title ?? "None"}</span>
        <span>{compact ? "Phone projection" : "Desktop projection"}</span>
        <span>{motion} motion</span>
        <span>Session memory only</span>
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
  onTheme,
  onDirection,
  onMotion,
}: {
  readonly theme: Theme;
  readonly direction: WorkspaceDirection;
  readonly motion: MotionProfile;
  readonly onTheme: (value: Theme) => void;
  readonly onDirection: (value: WorkspaceDirection) => void;
  readonly onMotion: (value: MotionProfile) => void;
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
                onTheme(event.target.value as Theme);
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
  const snapshot = runtime.getSnapshot();
  const reproduction = {
    engineVersion: "0.1.0",
    revision: snapshot.revision.toString(),
    capabilityProfile: { surface: "main", direction: document.dir || "ltr" },
    topology: {
      groups: snapshot.groups.ids,
      nodes: snapshot.nodes.ids,
      surfaces: snapshot.surfaces.ids,
    },
    commands: runtime.getTransactions().map((transaction) => ({
      id: transaction.id,
      origin: transaction.origin,
      label: transaction.label,
      revision: transaction.revision.toString(),
      type: transaction.command.type,
    })),
  };
  await navigator.clipboard.writeText(JSON.stringify(reproduction, null, 2));
}
