import { useState } from "react";
import { createPanel, createWorkspaceLayout } from "@panefold/model";
import {
  Workspace,
  WorkspaceSurface,
  useWorkspaceActions,
  useWorkspaceRuntime,
  useWorkspaceSelector,
  type WorkspacePanelRegistry,
  type WorkspacePanelRenderProps,
  type WorkspaceTabPlacement,
} from "@panefold/react";
import type { RuntimeDispatchReceipt } from "@panefold/runtime";
import "./docs-starter.css";

function panel(id: string, type: string, title: string) {
  return createPanel({
    id,
    type,
    title,
    capabilities: { singleton: true },
    constraints: { hardMinInline: 140, hardMinBlock: 140 },
    lifecycle: { hidden: "suspend", crossDocumentMove: "portal-coupled" },
  });
}
export const initialSnapshot = createWorkspaceLayout({
  panels: [
    panel("notes", "starter.notes", "Notes"),
    panel("map-canvas", "starter.preview", "Preview"),
    panel("feature-inspector", "starter.inspector", "Inspector"),
  ],
  layout: {
    id: "root",
    axis: "inline",
    weights: [65, 35],
    children: [
      {
        id: "primary",
        nodeId: "primary-node",
        panels: ["notes", "map-canvas"],
        region: "primary",
        persistent: true,
      },
      {
        id: "inspector",
        nodeId: "inspector-node",
        panels: ["feature-inspector"],
        region: "inspector",
        persistent: true,
      },
    ],
  },
  activePanelId: "notes",
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
        The model integration connects those gestures to the semantic kernel. The layout is in
        memory only.
      </p>
    </div>
  );
}
export const starterPanels: WorkspacePanelRegistry = {
  "starter.notes": { render: NotesPanel, icon: <span aria-hidden="true">✎</span> },
  "starter.preview": { render: PreviewPanel, icon: <span aria-hidden="true">◫</span> },
  "starter.inspector": { render: InspectorPanel, icon: <span aria-hidden="true">☷</span> },
};
export default function StarterWorkspace() {
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
    <main className="starter-app">
      <div className="starter-container">
        <a href={new URL("../docs/quickstart/", document.baseURI).href}>← Panefold quickstart</a>
        <p className="starter-kicker">Source-only · Experimental · Real runtime</p>
        <h1>Your first workspace.</h1>
        <p className="starter-lead">
          Three components. Two groups. One place to start. This smaller fixture does not use
          IndexedDB or open browser windows.
        </p>
        <Workspace
          initial={{ initialSnapshot, historyLimit: 50 }}
          fallback={<p role="status">Starting workspace…</p>}
        >
          <StarterToolbar
            placement={placement}
            onPlacementChange={setPlacement}
            iconsOnly={iconsOnly}
            onIconsOnlyChange={setIconsOnly}
            onResult={report}
          />
          <WorkspaceSurface
            panels={starterPanels}
            tabPresentation={{ placement, content: iconsOnly ? "icon-only" : "icon-and-label" }}
            motion="off"
            workspaceLabel="Starter workspace"
            className="starter-surface"
            onCommandResult={report}
          />
          <p className="starter-status" role="status">
            {status}
          </p>
        </Workspace>
        <p className="starter-footnote">
          Source: apps/demo/src/docs-starter.tsx. Workspace owns the runtime; WorkspaceSurface
          renders the layout. The toolbar and status are ordinary children alongside it.
        </p>
      </div>
    </main>
  );
}
function StarterToolbar({
  placement,
  onPlacementChange,
  iconsOnly,
  onIconsOnlyChange,
  onResult,
}: {
  readonly placement: WorkspaceTabPlacement;
  readonly onPlacementChange: (placement: WorkspaceTabPlacement) => void;
  readonly iconsOnly: boolean;
  readonly onIconsOnlyChange: (iconsOnly: boolean) => void;
  readonly onResult: (receipt: RuntimeDispatchReceipt) => void;
}) {
  const runtime = useWorkspaceRuntime();
  const actions = useWorkspaceActions();
  const revision = useWorkspaceSelector((snapshot) => snapshot.revision);
  const hasNotes = useWorkspaceSelector((snapshot) => snapshot.panels.byId.notes !== undefined);
  return (
    <div className="starter-toolbar">
      <label htmlFor="starter-tab-rail">Tab rail</label>
      <select
        id="starter-tab-rail"
        value={placement}
        onChange={(event) => onPlacementChange(event.target.value as WorkspaceTabPlacement)}
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
          onChange={(event) => onIconsOnlyChange(event.target.checked)}
        />{" "}
        Icons only
      </label>
      <button
        type="button"
        disabled={!hasNotes}
        onClick={() => onResult(actions.selectPanel("notes"))}
      >
        Show notes
      </button>
      <button type="button" disabled={!runtime.canUndo()} onClick={() => onResult(actions.undo())}>
        Undo layout
      </button>
      <button type="button" disabled={!runtime.canRedo()} onClick={() => onResult(actions.redo())}>
        Redo layout
      </button>
      <span>Revision {revision.toString()}</span>
    </div>
  );
}
