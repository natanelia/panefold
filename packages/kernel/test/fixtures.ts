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
  type SurfaceRecord,
  type WorkspaceSnapshot,
} from "@panefold/model";

export const ids = {
  panels: [panelId("panel:one"), panelId("panel:two"), panelId("panel:three")],
  groups: [groupId("group:left"), groupId("group:right")],
  nodes: [nodeId("node:left"), nodeId("node:right"), nodeId("node:root")],
  surface: surfaceId("surface:main"),
} as const;

export function panel(id: PanelRecord["id"], title = String(id)): PanelRecord {
  return {
    id,
    type: "test.panel",
    typeVersion: 1,
    title,
    parameters: { value: String(id) },
    capabilities: DEFAULT_PANEL_CAPABILITIES,
    constraints: {
      hardMinInline: 120,
      hardMinBlock: 80,
      preferredInline: 320,
      preferredBlock: 240,
    },
    lifecycle: DEFAULT_PANEL_LIFECYCLE,
  };
}

export function fixtureSnapshot(): WorkspaceSnapshot {
  const panels = ids.panels.map((id) => panel(id));
  const groups: readonly GroupRecord[] = [
    {
      id: ids.groups[0],
      panelIds: [ids.panels[0], ids.panels[1]],
      selectedPanelId: ids.panels[0],
      region: "primary",
      persistent: false,
    },
    {
      id: ids.groups[1],
      panelIds: [ids.panels[2]],
      selectedPanelId: ids.panels[2],
      region: "inspector",
      persistent: false,
    },
  ];
  const nodes: readonly LayoutNode[] = [
    { kind: "group", id: ids.nodes[0], groupId: ids.groups[0] },
    { kind: "group", id: ids.nodes[1], groupId: ids.groups[1] },
    {
      kind: "split",
      id: ids.nodes[2],
      axis: "inline",
      children: [ids.nodes[0], ids.nodes[1]],
      weights: [500_000, 500_000],
      collapsedChildIds: [],
    },
  ];
  const surface: SurfaceRecord = {
    id: ids.surface,
    kind: "main",
    rootNodeId: ids.nodes[2],
    capabilities: MAIN_SURFACE_CAPABILITIES,
    maximized: false,
  };
  return createWorkspaceSnapshot({
    panels,
    groups,
    nodes,
    surfaces: [surface],
    activation: {
      activePanelId: ids.panels[0],
      activeSurfaceId: surface.id,
    },
    focusMemory: {
      panelId: ids.panels[0],
      groupId: ids.groups[0],
      fallback: "panel-root",
    },
  });
}
