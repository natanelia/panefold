import {
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  MAIN_SURFACE_CAPABILITIES,
  createWorkspaceSnapshot,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type PanelRecord,
  type WorkspaceSnapshotInput,
} from "@panefold/model";

export const modelBounds = { inlineStart: 0, blockStart: 0, inlineSize: 1000, blockSize: 600 };

export function modelPanel(id: string, minInline = 160): PanelRecord {
  return {
    id: panelId(id),
    type: "test.panel",
    typeVersion: 1,
    title: id.toUpperCase(),
    parameters: { id },
    capabilities: DEFAULT_PANEL_CAPABILITIES,
    constraints: { hardMinInline: minInline, hardMinBlock: 120, resizeDelivery: "deferred" },
    lifecycle: DEFAULT_PANEL_LIFECYCLE,
  };
}

export function modelFixture(overrides: WorkspaceSnapshotInput = {}) {
  return createWorkspaceSnapshot({
    panels: [modelPanel("a", 420), modelPanel("b", 420), modelPanel("c")],
    groups: [
      {
        id: groupId("left"),
        panelIds: [panelId("a"), panelId("b")],
        selectedPanelId: panelId("a"),
        persistent: true,
      },
      {
        id: groupId("right"),
        panelIds: [panelId("c")],
        selectedPanelId: panelId("c"),
        persistent: true,
      },
    ],
    nodes: [
      {
        kind: "split",
        id: nodeId("root"),
        axis: "inline",
        children: [nodeId("left-node"), nodeId("right-node")],
        weights: [100_000, 900_000],
        collapsedChildIds: [],
      },
      { kind: "group", id: nodeId("left-node"), groupId: groupId("left") },
      { kind: "group", id: nodeId("right-node"), groupId: groupId("right") },
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
    activation: { activePanelId: panelId("a"), activeSurfaceId: surfaceId("main") },
    ...overrides,
  });
}
