import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { solveLayout } from "@panefold/geometry";
import {
  MAIN_SURFACE_CAPABILITIES,
  createWorkspaceSnapshot,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type PanelRecord,
  type WorkspaceSnapshot,
} from "@panefold/model";
import {
  WorkspaceRuntimeProvider,
  WorkspaceSurface,
  type WorkspaceLayoutSolver,
  type WorkspacePanelRegistry,
  type WorkspacePanelRenderProps,
  type WorkspaceTabPlacement,
} from "@panefold/react";
import {
  createWorkspaceRuntime,
  type RuntimeDispatchReceipt,
  type WorkspaceRuntime,
} from "@panefold/runtime";
// These are application-owned reference adapters, not library exports.
import { createDemoCommands, projectWorkspace } from "./workspace-config";
import "./docs-starter.css";

function panel(id: string, type: string, title: string): PanelRecord {
  return {
    id: panelId(id),
    type,
    typeVersion: 1,
    title,
    parameters: {},
    capabilities: {
      closable: true,
      floatable: true,
      popout: false,
      pictureInPicture: false,
      singleton: true,
    },
    constraints: { hardMinInline: 140, hardMinBlock: 140 },
    lifecycle: {
      hidden: "suspend",
      sameDocumentMove: "preserve-host",
      crossDocumentMove: "portal-coupled",
    },
  };
}
export const initialSnapshot = createWorkspaceSnapshot({
  applicationLayoutVersion: 1,
  panels: [
    panel("notes", "starter.notes", "Notes"),
    panel("map-canvas", "starter.preview", "Preview"),
    panel("feature-inspector", "starter.inspector", "Inspector"),
  ],
  groups: [
    {
      id: groupId("primary"),
      panelIds: [panelId("notes"), panelId("map-canvas")],
      selectedPanelId: panelId("notes"),
      region: "primary",
      persistent: true,
    },
    {
      id: groupId("inspector"),
      panelIds: [panelId("feature-inspector")],
      selectedPanelId: panelId("feature-inspector"),
      region: "inspector",
      persistent: true,
    },
  ],
  nodes: [
    {
      kind: "split",
      id: nodeId("root"),
      axis: "inline",
      children: [nodeId("primary-node"), nodeId("inspector-node")],
      weights: [650_000, 350_000],
      collapsedChildIds: [],
    },
    { kind: "group", id: nodeId("primary-node"), groupId: groupId("primary") },
    { kind: "group", id: nodeId("inspector-node"), groupId: groupId("inspector") },
  ],
  surfaces: [
    {
      id: surfaceId("main"),
      kind: "main",
      rootNodeId: nodeId("root"),
      capabilities: MAIN_SURFACE_CAPABILITIES,
      maximized: false,
    },
  ],
  activation: { activePanelId: panelId("notes"), activeSurfaceId: surfaceId("main") },
  focusMemory: { panelId: panelId("notes"), groupId: groupId("primary"), fallback: "selected-tab" },
});
function NotesPanel({ lifecycle }: WorkspacePanelRenderProps) {
  const [text, setText] = useState(
    "Make room for the next idea.\n\nType here, then move this tab into the Inspector group. Your text stays with its panel host.",
  );
  return (
    <div className="starter-panel">
      <p className="starter-kicker">A real React component · {lifecycle}</p>
      <label htmlFor="starter-note">Your note</label>
      <textarea id="starter-note" value={text} onChange={(event) => setText(event.target.value)} />
      <p>This text is component state. Reload resets it; workspace undo does not undo edits.</p>
    </div>
  );
}
function PreviewPanel() {
  return (
    <div className="starter-panel">
      <p className="starter-kicker">Your content goes here</p>
      <h2>Keep the application yours.</h2>
      <p>
        Replace this component with your editor, map, chart or preview. Panefold manages the
        workspace around it.
      </p>
      <p>Use the tab's Actions menu to split, float or move a panel without dragging.</p>
    </div>
  );
}
function InspectorPanel() {
  return (
    <div className="starter-panel">
      <p className="starter-kicker">Try a different arrangement</p>
      <h2>A second place to work.</h2>
      <p>
        Drop Notes in the center of this group to dock it here. Drop at an edge to create a split.
      </p>
      <p>
        The reference command adapter connects those gestures to the semantic kernel. The layout is
        in memory only.
      </p>
    </div>
  );
}
export const starterPanels: WorkspacePanelRegistry = {
  "starter.notes": { render: NotesPanel, icon: <span aria-hidden="true">✎</span> },
  "starter.preview": { render: PreviewPanel, icon: <span aria-hidden="true">◫</span> },
  "starter.inspector": { render: InspectorPanel, icon: <span aria-hidden="true">☷</span> },
};
export const layoutSolver: WorkspaceLayoutSolver<WorkspaceSnapshot> = (snapshot, request) =>
  solveLayout(snapshot, nodeId(request.rootNodeId), request.bounds, {
    splitterSize: request.splitterSize,
    splitOverrides: request.splitOverrides,
  });

export default function StarterWorkspace() {
  const [runtime, setRuntime] = useState<WorkspaceRuntime>();
  useEffect(() => {
    const session = createWorkspaceRuntime({ initialSnapshot, historyLimit: 50 });
    setRuntime(session);
    return () => session.dispose();
  }, []);
  return (
    <main className="starter-app">
      <div className="starter-container">
        <a href={new URL("../docs/quickstart/", document.baseURI).href}>← Panefold quickstart</a>
        <p className="starter-kicker">Source-only · Experimental · Real runtime</p>
        <h1>Your first workspace.</h1>
        <p className="starter-lead">
          Three components. Two groups. One place to start. This smaller fixture does not use
          IndexedDB or open browser windows.
        </p>
        {runtime ? (
          <WorkspaceRuntimeProvider runtime={runtime}>
            <StarterSurface runtime={runtime} />
          </WorkspaceRuntimeProvider>
        ) : (
          <p role="status">Starting workspace…</p>
        )}
        <p className="starter-footnote">
          Source: apps/demo/src/docs-starter.tsx. Projection and commands reuse the reference
          application's workspace-config.ts helpers.
        </p>
      </div>
    </main>
  );
}
function StarterSurface({ runtime }: { readonly runtime: WorkspaceRuntime }) {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const commands = useMemo(() => createDemoCommands(runtime.getSnapshot), [runtime]);
  const [placement, setPlacement] = useState<WorkspaceTabPlacement>("block-start");
  const [iconsOnly, setIconsOnly] = useState(false);
  const [status, setStatus] = useState(
    "Layout lives in memory. Drag, resize, or use a tab's Actions menu.",
  );
  const report = (receipt: RuntimeDispatchReceipt) =>
    setStatus(
      receipt.status === "rejected"
        ? `Not changed: ${receipt.result.error.code}`
        : receipt.status === "queued"
          ? "Command queued; not yet committed."
          : `Committed revision ${receipt.result.state.snapshot.revision.toString()}.`,
    );
  return (
    <>
      <div className="starter-toolbar">
        <label htmlFor="starter-tab-rail">Tab rail</label>
        <select
          id="starter-tab-rail"
          value={placement}
          onChange={(event) => setPlacement(event.target.value as WorkspaceTabPlacement)}
        >
          <option value="block-start">Top</option>
          <option value="block-end">Bottom</option>
          <option value="inline-start">Start</option>
          <option value="inline-end">End</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={iconsOnly}
            onChange={(event) => setIconsOnly(event.target.checked)}
          />{" "}
          Icons only
        </label>
        <button type="button" disabled={!runtime.canUndo()} onClick={() => report(runtime.undo())}>
          Undo layout
        </button>
        <button type="button" disabled={!runtime.canRedo()} onClick={() => report(runtime.redo())}>
          Redo layout
        </button>
        <span>Revision {snapshot.revision.toString()}</span>
      </div>
      <WorkspaceSurface
        projector={projectWorkspace}
        commands={commands}
        panels={starterPanels}
        layoutSolver={layoutSolver}
        tabPresentation={{ placement, content: iconsOnly ? "icon-only" : "icon-and-label" }}
        motion="off"
        workspaceLabel="Starter workspace"
        className="starter-surface"
        onCommandResult={report}
      />
      <p className="starter-status" role="status">
        {status}
      </p>
    </>
  );
}
