import {
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  MAIN_SURFACE_CAPABILITIES,
  createWorkspaceSnapshot,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type GroupRecord,
  type LayoutNode,
  type PanelRecord,
  type WorkspaceSnapshot,
} from "@panefold/model";

export const fixtureIds = {
  panels: [
    panelId("optimized:panel:one"),
    panelId("optimized:panel:two"),
    panelId("optimized:panel:three"),
  ],
  groups: [groupId("optimized:group:left"), groupId("optimized:group:right")],
  nodes: [
    nodeId("optimized:node:left"),
    nodeId("optimized:node:right"),
    nodeId("optimized:node:root"),
  ],
  surface: surfaceId("optimized:surface:main"),
} as const;

export function fixturePanel(id: PanelRecord["id"]): PanelRecord {
  return {
    id,
    type: "optimized.test-panel",
    typeVersion: 1,
    title: String(id),
    parameters: {},
    capabilities: DEFAULT_PANEL_CAPABILITIES,
    constraints: {
      hardMinInline: 80,
      hardMinBlock: 60,
      preferredInline: 320,
      preferredBlock: 240,
    },
    lifecycle: DEFAULT_PANEL_LIFECYCLE,
  };
}

export function fixtureSnapshot(): WorkspaceSnapshot {
  const groups: readonly GroupRecord[] = [
    {
      id: fixtureIds.groups[0],
      panelIds: [fixtureIds.panels[0], fixtureIds.panels[1]],
      selectedPanelId: fixtureIds.panels[0],
      persistent: false,
    },
    {
      id: fixtureIds.groups[1],
      panelIds: [fixtureIds.panels[2]],
      selectedPanelId: fixtureIds.panels[2],
      persistent: false,
    },
  ];
  const nodes: readonly LayoutNode[] = [
    { kind: "group", id: fixtureIds.nodes[0], groupId: fixtureIds.groups[0] },
    { kind: "group", id: fixtureIds.nodes[1], groupId: fixtureIds.groups[1] },
    {
      kind: "split",
      id: fixtureIds.nodes[2],
      axis: "inline",
      children: [fixtureIds.nodes[0], fixtureIds.nodes[1]],
      weights: [500_000, 500_000],
      collapsedChildIds: [],
    },
  ];
  return createWorkspaceSnapshot({
    panels: fixtureIds.panels.map(fixturePanel),
    groups,
    nodes,
    surfaces: [
      {
        id: fixtureIds.surface,
        kind: "main",
        rootNodeId: fixtureIds.nodes[2],
        capabilities: MAIN_SURFACE_CAPABILITIES,
        maximized: false,
      },
    ],
    activation: {
      activePanelId: fixtureIds.panels[0],
      activeSurfaceId: fixtureIds.surface,
    },
  });
}
