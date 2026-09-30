import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { getEntity, panelId, type WorkspaceSnapshot, type WorkspaceCommand } from "@panefold/model";
import {
  WorkspaceRuntimeProvider,
  WorkspaceSurface,
  type WorkspacePanelRegistry,
  type WorkspacePanelRenderProps,
} from "@panefold/react";
import {
  createWorkspaceRuntime,
  type RuntimeDispatchReceipt,
  type WorkspaceRuntime,
} from "@panefold/runtime";
import {
  createPlaygroundCommands,
  planPlaygroundMove,
  playgroundBounds,
  playgroundPanelNames,
  PLAYGROUND_SPLITTER,
  PLAYGROUND_TITLEBAR,
  playgroundSurfaceForGroup,
  playgroundSurfaceBounds,
  playgroundSnapshot,
  previewPlaygroundCommand,
  projectPlayground,
  solvePlayground,
  type Placement,
} from "./playground-model";
import { openPlaygroundSession, type PlaygroundSession } from "./playground-session";
import type { LogicalRect } from "@panefold/geometry";
import "./touch-playground.css";
import { TouchButton } from "./TouchButton";

const NoteContext = createContext({
  text: "Build something that fits.\n\nMove Notes beside Preview, or split Checklist below it.",
  setText: (_value: string) => {},
});
function Notes() {
  const { text, setText } = useContext(NoteContext);
  return (
    <PanelContent note>
      <label htmlFor="playground-note">Your working note</label>
      <textarea
        id="playground-note"
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
      />
      <p>Your text stays with this panel when you move it.</p>
    </PanelContent>
  );
}
function Preview() {
  const { text } = useContext(NoteContext);
  return (
    <PanelContent>
      <p className="tp-eyebrow">Live preview</p>
      <h3>Room for your ideas.</h3>
      <p className="tp-note-preview">{text || "Write something in Notes."}</p>
      <span className="tp-badge">Connected to Notes</span>
    </PanelContent>
  );
}
function Checklist() {
  const [checked, setChecked] = useState<readonly number[]>([]);
  return (
    <PanelContent>
      <h3>Make it your workspace.</h3>
      {["Move a panel", "Make a nested split", "Resize a divider"].map((label, index) => (
        <label className="tp-task" key={label}>
          <input
            type="checkbox"
            checked={checked.includes(index)}
            onChange={(event) =>
              setChecked((current) =>
                event.target.checked
                  ? [...current, index]
                  : current.filter((item) => item !== index),
              )
            }
          />
          <span>{label}</span>
        </label>
      ))}
    </PanelContent>
  );
}
function Activity({ panel }: WorkspacePanelRenderProps) {
  return (
    <PanelContent>
      <p className="tp-eyebrow">{panel.title}</p>
      <h3>The same workspace engine.</h3>
      <p>
        Drag, dock, split, float, and undo. This example uses real Panefold panels, not a separate
        mobile layout.
      </p>
      <p>Layout saves in this browser. Sample note and checklist content resets on reload.</p>
    </PanelContent>
  );
}
function PanelContent({
  children,
  note = false,
}: {
  readonly children: ReactNode;
  readonly note?: boolean;
}) {
  return (
    <div className={`tp-content${note ? " tp-note" : ""}`} tabIndex={0}>
      {children}
      <div className="tp-drop-guide" aria-hidden="true">
        <span className="tp-guide-above">↑ Above</span>
        <span>← Left</span>
        <span>Tabs</span>
        <span>Right →</span>
        <span className="tp-guide-below">↓ Below</span>
      </div>
    </div>
  );
}
const panels: WorkspacePanelRegistry = {
  "playground.notes": { render: Notes },
  "playground.preview": { render: Preview },
  "playground.checklist": { render: Checklist },
  "playground.activity": { render: Activity },
};
const dropBehavior = {
  edgeBandRatio: 1 / 3,
  preferredSplitDirection: "down",
  centerGroupDrop: "merge",
} as const;

export default function TouchPlayground() {
  const [session, setSession] = useState<PlaygroundSession>();
  const [temporary, setTemporary] = useState<WorkspaceRuntime>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let opened: PlaygroundSession | undefined;
    void openPlaygroundSession()
      .then((value) => {
        opened = value;
        if (disposed) void value.dispose().catch(() => undefined);
        else setSession(value);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      if (opened) void opened.dispose().catch(() => undefined);
    };
  }, []);
  useEffect(() => () => temporary?.dispose(), [temporary]);
  const runtime = session?.runtime ?? temporary;
  if (!runtime)
    return (
      <main className="touch-playground tp-loading">
        <h1>Panefold Playground</h1>
        {failed ? (
          <>
            <p role="alert">
              The saved workspace could not be opened. Your saved data has not been removed.
            </p>
            <TouchButton
              onClick={() =>
                setTemporary(createWorkspaceRuntime({ initialSnapshot: playgroundSnapshot }))
              }
            >
              Continue without saving
            </TouchButton>
            <TouchButton onClick={() => location.reload()}>Retry</TouchButton>
          </>
        ) : (
          <p role="status">Opening your workspace…</p>
        )}
      </main>
    );
  return (
    <WorkspaceRuntimeProvider runtime={runtime}>
      <Playground runtime={runtime} session={session} />
    </WorkspaceRuntimeProvider>
  );
}

function Playground({
  runtime,
  session,
}: {
  readonly runtime: WorkspaceRuntime;
  readonly session: PlaygroundSession | undefined;
}) {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const projection = useMemo(() => projectPlayground(snapshot), [snapshot]);
  const [text, setText] = useState(
    "Build something that fits.\n\nMove Notes beside Preview, or split Checklist below it.",
  );
  const note = useMemo(() => ({ text, setText }), [text]);
  const [arranging, setArranging] = useState(false);
  const [sheet, setSheet] = useState<"panels" | "move" | "help" | undefined>();
  const [message, setMessage] = useState("Drag a grip to move. Drop at an edge to split.");
  const [durable, setDurable] = useState(() => session?.durable.getStatus());
  const viewportRef = useRef<HTMLDivElement>(null);
  const commands = useMemo(
    () =>
      createPlaygroundCommands(runtime.getSnapshot, () => ({
        inlineStart: 0,
        blockStart: 0,
        inlineSize: viewportRef.current?.clientWidth ?? 360,
        blockSize: viewportRef.current?.clientHeight ?? 500,
      })),
    [runtime],
  );
  const [viewport, setViewport] = useState({ width: 360, height: 500 });
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setViewport((current) =>
        element.clientWidth === current.width && element.clientHeight === current.height
          ? current
          : { width: element.clientWidth, height: element.clientHeight },
      ),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => session?.durable.subscribeStatus(setDurable), [session]);
  const bounds = useMemo(
    () =>
      playgroundBounds(snapshot, projection.rootNodeId, {
        inlineStart: 0,
        blockStart: 0,
        inlineSize: viewport.width,
        blockSize: viewport.height,
      }),
    [snapshot, projection.rootNodeId, viewport],
  );
  const revealPanel = (id: string) => {
    requestAnimationFrame(() => {
      const tab = [
        ...(viewportRef.current?.querySelectorAll<HTMLElement>("[data-workspace-panel-tab]") ?? []),
      ].find((element) => element.dataset.workspacePanelTab === id);
      tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };
  const report = (receipt: RuntimeDispatchReceipt) => {
    if (receipt.status === "rejected")
      setMessage(`Not changed. ${receipt.result.error.remediation}`);
    else if (receipt.status === "queued") setMessage("Waiting for the layout change.");
    else {
      setMessage("Layout changed. Undo is available below.");
      const active = runtime.getSnapshot().activation.activePanelId;
      if (active) revealPanel(active);
    }
  };
  const run = (command: WorkspaceCommand) =>
    report(runtime.dispatch(command, { origin: "menu", label: "Arrange playground" }));
  const select = (id: string) => {
    const record = getEntity(snapshot.panels, panelId(id));
    if (record) {
      const group = Object.values(projection.groups).find((group) => group.panelIds.includes(id));
      const surface = group && playgroundSurfaceForGroup(snapshot, group.id);
      const restore = surface?.kind === "floating" && surface.minimized;
      run({
        type: "batch",
        commands: [
          ...(restore ? [{ type: "restore-surface" as const, surfaceId: surface.id }] : []),
          ...(surface?.kind === "floating"
            ? [{ type: "raise-surface" as const, surfaceId: surface.id }]
            : []),
          { type: "select-panel", panelId: panelId(id), activate: true },
        ],
      });
    } else {
      const closed = [...snapshot.recoverableClosedPanels]
        .reverse()
        .find((entry) => String(entry.panel.id) === id);
      if (closed)
        run({ type: "reopen-panel", closedPanelId: closed.id, select: true, activate: true });
    }
    setSheet(undefined);
    revealPanel(id);
  };
  const saveLabel = !session
    ? "Temporary · not saved"
    : durable?.error || durable?.degraded
      ? "Layout not saved"
      : durable?.pendingWrites
        ? "Saving layout…"
        : durable?.lastPersistedRevision
          ? "Layout saved"
          : "Layout ready";
  const overflow = bounds.inlineSize > viewport.width + 1 || bounds.blockSize > viewport.height + 1;
  const activePanelId = projection.activePanelId ?? Object.keys(projection.panels)[0];
  return (
    <NoteContext.Provider value={note}>
      <main
        className="touch-playground"
        data-arranging={arranging}
        data-workspace-revision={snapshot.revision.toString()}
      >
        <header className="tp-header">
          <div>
            <h1>
              <a href={new URL("../", document.baseURI).href} aria-label="Panefold home">
                Panefold
              </a>{" "}
              <span>Playground</span>
            </h1>
            <p>Arrange it around your work.</p>
          </div>
          <TouchButton type="button" onClick={() => setSheet("help")} aria-label="Playground help">
            ?
          </TouchButton>
        </header>
        <div className="tp-hint" aria-live="polite">
          {arranging ? "Arrange: drag any tab. Use Move for tap-to-place." : message}
        </div>
        <div
          className="tp-viewport"
          ref={viewportRef}
          tabIndex={0}
          aria-label="Scrollable panel workspace"
        >
          <div className="tp-canvas" style={{ width: bounds.inlineSize, height: bounds.blockSize }}>
            <WorkspaceSurface
              projector={projectPlayground}
              commands={commands}
              panels={panels}
              layoutSolver={solvePlayground}
              layoutBounds={bounds}
              splitterSize={PLAYGROUND_SPLITTER}
              floatingTitlebarSize={PLAYGROUND_TITLEBAR}
              responsive={false}
              motion="off"
              dropBehavior={dropBehavior}
              tabPresentation={{ placement: "block-start", content: "label-only" }}
              className="tp-workspace"
              workspaceLabel="Touch playground workspace"
              onCommandResult={report}
            />
          </div>
        </div>
        <div className="tp-save" role="status">
          <span>{saveLabel}</span>
          {overflow ? (
            <span>Swipe for more · Move can reach every pane</span>
          ) : (
            <span>{snapshot.groups.ids.length} panes</span>
          )}
          {durable?.error ? (
            <TouchButton
              onClick={() => {
                void session?.durable
                  .retry()
                  .catch(() => setMessage("Saving failed. Try again later."));
              }}
            >
              Retry save
            </TouchButton>
          ) : null}
        </div>
        <nav className="tp-toolbar" aria-label="Workspace tools">
          <TouchButton type="button" onClick={() => setSheet("panels")}>
            <span aria-hidden="true">▦</span>Panels
          </TouchButton>
          <TouchButton
            type="button"
            aria-pressed={arranging}
            onClick={() => setArranging((value) => !value)}
          >
            <span aria-hidden="true">⠿</span>
            {arranging ? "Done" : "Arrange"}
          </TouchButton>
          <TouchButton type="button" onClick={() => setSheet("move")} disabled={!activePanelId}>
            <span aria-hidden="true">↗</span>Move
          </TouchButton>
          <TouchButton
            type="button"
            disabled={!runtime.canUndo()}
            onClick={() => report(runtime.undo())}
          >
            <span aria-hidden="true">↶</span>Undo
          </TouchButton>
          <TouchButton
            type="button"
            disabled={!runtime.canRedo()}
            onClick={() => report(runtime.redo())}
          >
            <span aria-hidden="true">↷</span>Redo
          </TouchButton>
        </nav>
        {sheet ? (
          <Sheet
            title={
              sheet === "panels"
                ? "Your panels"
                : sheet === "move"
                  ? "Move or split a panel"
                  : "Make room to work"
            }
            onClose={() => setSheet(undefined)}
          >
            {sheet === "panels" ? (
              <>
                <p>Open a panel or return to one you closed.</p>
                <div className="tp-panel-picker">
                  {Object.entries(playgroundPanelNames).map(([id, title]) => (
                    <TouchButton key={id} onClick={() => select(id)}>
                      <strong>{title}</strong>
                      <span>{projection.panels[id] ? "Show panel →" : "Reopen panel →"}</span>
                    </TouchButton>
                  ))}
                </div>
              </>
            ) : sheet === "move" && activePanelId ? (
              <MoveSheet
                snapshot={snapshot}
                initialPanelId={activePanelId}
                bounds={{
                  inlineStart: 0,
                  blockStart: 0,
                  inlineSize: viewport.width,
                  blockSize: viewport.height,
                }}
                onMove={(command, id) => {
                  run(command);
                  setSheet(undefined);
                  revealPanel(id);
                }}
              />
            ) : (
              <>
                <p>
                  <strong>Move with your finger.</strong> Drag the grip beside a tab. In Arrange
                  mode, you can drag the whole tab.
                </p>
                <p>
                  <strong>Choose a place.</strong> Drop in the middle to make tabs. Drop in the
                  outer third to split above, below, or beside a pane.
                </p>
                <p>
                  <strong>Make a nested split.</strong> Repeat inside any pane. Drag the dividers to
                  resize. Panes keep a readable minimum size; scroll to reach larger layouts.
                </p>
                <p>
                  <strong>No need to hold a drag.</strong> Use Move, select a destination, check the
                  preview, then apply. This also reaches panes outside the screen.
                </p>
                <p>
                  <strong>Move a whole group.</strong> In Arrange mode, drag its separate group
                  grip. The panel menu also includes floating and group operations.
                </p>
                <p className="tp-muted">
                  Layout saves separately from the Code example. Sample content stays during moves
                  but resets after reload.
                </p>
                <a className="tp-code-link" href={new URL("?fixture=code", document.baseURI).href}>
                  Open the full Code example →
                </a>
              </>
            )}
          </Sheet>
        ) : null}
      </main>
    </NoteContext.Provider>
  );
}

function Sheet({
  title,
  children,
  onClose,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog ref={ref} className="tp-sheet" aria-label={title} onCancel={onClose}>
      <header>
        <h2>{title}</h2>
        <TouchButton type="button" autoFocus aria-label="Close panel sheet" onClick={onClose}>
          ×
        </TouchButton>
      </header>
      <div className="tp-sheet-body">{children}</div>
    </dialog>
  );
}
const placements: readonly [Placement, string, string][] = [
  ["block-start", "Above", "↑"],
  ["inline-start", "Left", "←"],
  ["center", "As tab", "▣"],
  ["inline-end", "Right", "→"],
  ["block-end", "Below", "↓"],
];

function MoveSheet({
  snapshot,
  initialPanelId,
  bounds,
  onMove,
}: {
  readonly snapshot: WorkspaceSnapshot;
  readonly initialPanelId: string;
  readonly bounds: LogicalRect;
  readonly onMove: (command: WorkspaceCommand, id: string) => void;
}) {
  const projection = useMemo(() => projectPlayground(snapshot), [snapshot]);
  const fieldId = useId();
  const [source, setSource] = useState(initialPanelId);
  const [target, setTarget] = useState(
    () =>
      Object.values(projection.groups).find((group) => !group.panelIds.includes(source))?.id ??
      Object.keys(projection.groups)[0] ??
      "",
  );
  const [placement, setPlacement] = useState<Placement>("block-end");
  const plan = useMemo(
    () => planPlaygroundMove(snapshot, source, target, placement, bounds),
    [snapshot, source, target, placement, bounds],
  );
  const next = useMemo(
    () => (plan ? previewPlaygroundCommand(snapshot, plan.command) : undefined),
    [snapshot, plan],
  );
  return (
    <div className="tp-move-sheet">
      <label htmlFor={`${fieldId}-panel`}>Panel</label>
      <select
        id={`${fieldId}-panel`}
        value={source}
        onChange={(event) => setSource(event.target.value)}
      >
        {Object.values(projection.panels).map((panel) => (
          <option key={panel.id} value={panel.id}>
            {panel.title}
          </option>
        ))}
      </select>
      <label htmlFor={`${fieldId}-target`}>Destination pane</label>
      <select
        id={`${fieldId}-target`}
        value={target}
        onChange={(event) => setTarget(event.target.value)}
      >
        {Object.values(projection.groups).map((group) => (
          <option key={group.id} value={group.id}>
            {group.label}
          </option>
        ))}
      </select>
      <fieldset>
        <legend>Place the panel</legend>
        <div className="tp-placements">
          {placements.map(([value, label, icon]) => (
            <TouchButton
              key={value}
              type="button"
              data-place={value}
              aria-pressed={placement === value}
              onClick={() => setPlacement(value)}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </TouchButton>
          ))}
        </div>
      </fieldset>
      {next ? (
        <LayoutPreview snapshot={next} selected={source} />
      ) : (
        <p role="status">Choose another position or pane. This move would not change the layout.</p>
      )}
      <TouchButton
        type="button"
        className="tp-apply"
        disabled={!plan}
        onClick={() => {
          if (plan) onMove(plan.command, source);
        }}
      >
        Apply move
      </TouchButton>
      <p className="tp-muted">You can undo this change. Larger layouts remain scrollable.</p>
    </div>
  );
}
function LayoutPreview({
  snapshot,
  selected,
}: {
  readonly snapshot: WorkspaceSnapshot;
  readonly selected: string;
}) {
  const projection = projectPlayground(snapshot);
  const group = Object.values(projection.groups).find((group) => group.panelIds.includes(selected));
  const surface = group && playgroundSurfaceForGroup(snapshot, group.id);
  const rootNodeId = surface?.rootNodeId ?? projection.rootNodeId;
  const viewport = { inlineStart: 0, blockStart: 0, inlineSize: 368, blockSize: 440 };
  const bounds = playgroundBounds(
    snapshot,
    rootNodeId,
    surface ? playgroundSurfaceBounds(snapshot, surface, viewport) : viewport,
  );
  const layout = solvePlayground(snapshot, {
    projection,
    rootNodeId,
    bounds,
    splitterSize: PLAYGROUND_SPLITTER,
    splitOverrides: {},
  });
  return (
    <div>
      <p className="tp-preview-label">
        After this move{surface?.kind === "floating" ? " · Floating window" : ""}
      </p>
      <div
        className="tp-layout-preview"
        role="img"
        aria-label={`Layout preview with ${Object.keys(layout.groupRects).length} panes`}
      >
        {Object.entries(layout.groupRects).map(([id, rect]) => (
          <div
            key={id}
            data-selected={projection.groups[id]?.panelIds.includes(selected)}
            style={{
              left: `${((rect.inlineStart - bounds.inlineStart) / bounds.inlineSize) * 100}%`,
              top: `${((rect.blockStart - bounds.blockStart) / bounds.blockSize) * 100}%`,
              width: `${(rect.inlineSize / bounds.inlineSize) * 100}%`,
              height: `${(rect.blockSize / bounds.blockSize) * 100}%`,
            }}
          >
            <span>{projection.groups[id]?.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
