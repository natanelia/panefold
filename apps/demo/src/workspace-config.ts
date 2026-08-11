import {
  MAIN_SURFACE_CAPABILITIES,
  closedPanelId,
  createWorkspaceSnapshot,
  getEntity,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type GroupRecord,
  type LayoutNode,
  type PanelCapabilities,
  type PanelLifecyclePolicy,
  type PanelRecord,
  type SurfaceRecord,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";
import type { WorkspaceCommandAdapter, WorkspaceProjection } from "@panefold/react";

const capabilities: PanelCapabilities = {
  closable: true,
  floatable: true,
  popout: false,
  pictureInPicture: false,
  singleton: true,
};

const lifecycle: PanelLifecyclePolicy = {
  hidden: "keep-alive",
  sameDocumentMove: "preserve-host",
  crossDocumentMove: "unsupported",
};

function panel(
  id: string,
  type: string,
  title: string,
  constraints: PanelRecord["constraints"] = {},
): PanelRecord {
  return {
    id: panelId(id),
    type,
    typeVersion: 1,
    title,
    parameters: {},
    capabilities,
    constraints,
    lifecycle,
  };
}

const panelRecords = [
  panel("route-explorer", "map.route-explorer", "Routes", {
    hardMinInline: 180,
    preferredInline: 250,
  }),
  panel("layers", "map.layers", "Layers", {
    hardMinInline: 180,
    preferredInline: 250,
  }),
  panel("map-canvas", "map.canvas", "Map Canvas", {
    hardMinInline: 320,
    hardMinBlock: 220,
    preferredInline: 900,
    preferredBlock: 650,
    resizeDelivery: "adaptive",
  }),
  panel("notes", "map.notes", "Notes", {
    hardMinInline: 240,
    hardMinBlock: 160,
  }),
  panel("feature-inspector", "map.inspector", "Inspector", {
    hardMinInline: 230,
    preferredInline: 310,
  }),
  panel("validation", "map.validation", "Validation", {
    hardMinInline: 230,
    preferredInline: 310,
  }),
  panel("problems", "map.problems", "Problems", {
    hardMinBlock: 130,
    preferredBlock: 220,
    resizeDelivery: "throttled",
  }),
  panel("timeline", "map.timeline", "Timeline", {
    hardMinBlock: 130,
    preferredBlock: 220,
  }),
] as const;

const groups: readonly GroupRecord[] = [
  {
    id: groupId("navigation"),
    panelIds: [panelId("route-explorer"), panelId("layers")],
    selectedPanelId: panelId("route-explorer"),
    region: "navigation",
    persistent: true,
  },
  {
    id: groupId("primary"),
    panelIds: [panelId("map-canvas"), panelId("notes")],
    selectedPanelId: panelId("map-canvas"),
    region: "primary",
    persistent: true,
  },
  {
    id: groupId("inspector"),
    panelIds: [panelId("feature-inspector"), panelId("validation")],
    selectedPanelId: panelId("feature-inspector"),
    region: "inspector",
    persistent: true,
  },
  {
    id: groupId("output"),
    panelIds: [panelId("problems"), panelId("timeline")],
    selectedPanelId: panelId("problems"),
    region: "output",
    persistent: true,
  },
];

const nodes: readonly LayoutNode[] = [
  {
    kind: "split",
    id: nodeId("root"),
    axis: "inline",
    children: [nodeId("navigation-node"), nodeId("center-stack"), nodeId("inspector-node")],
    weights: [220_000, 550_000, 230_000],
    collapsedChildIds: [],
  },
  {
    kind: "group",
    id: nodeId("navigation-node"),
    groupId: groupId("navigation"),
  },
  {
    kind: "split",
    id: nodeId("center-stack"),
    axis: "block",
    children: [nodeId("primary-node"), nodeId("output-node")],
    weights: [720_000, 280_000],
    collapsedChildIds: [],
  },
  {
    kind: "group",
    id: nodeId("primary-node"),
    groupId: groupId("primary"),
  },
  {
    kind: "group",
    id: nodeId("output-node"),
    groupId: groupId("output"),
  },
  {
    kind: "group",
    id: nodeId("inspector-node"),
    groupId: groupId("inspector"),
  },
];

const surfaces: readonly SurfaceRecord[] = [
  {
    id: surfaceId("main"),
    kind: "main",
    rootNodeId: nodeId("root"),
    capabilities: MAIN_SURFACE_CAPABILITIES,
    maximized: false,
  },
];

export const initialWorkspaceSnapshot = createWorkspaceSnapshot({
  panels: panelRecords,
  groups,
  nodes,
  surfaces,
  activation: {
    activePanelId: panelId("map-canvas"),
    activeSurfaceId: surfaceId("main"),
  },
  focusMemory: {
    panelId: panelId("map-canvas"),
    groupId: groupId("primary"),
    fallback: "selected-tab",
  },
  metadata: {
    name: "One-North route review",
    locale: "en-SG",
  },
});

const groupLabels: Readonly<Record<string, string>> = {
  navigation: "Navigation",
  primary: "Primary workspace",
  inspector: "Inspector",
  output: "Problems and activity",
};

export function projectWorkspace(snapshot: WorkspaceSnapshot): WorkspaceProjection {
  const mainSurface = snapshot.surfaces.ids
    .map((id) => getEntity(snapshot.surfaces, id))
    .find((surface) => surface?.kind === "main");
  if (mainSurface === undefined) {
    return {
      revision: snapshot.revision.toString(),
      rootNodeId: "",
      nodes: {},
      groups: {},
      panels: {},
      diagnosticCount: 1,
    };
  }

  const projectedNodes: Record<string, WorkspaceProjection["nodes"][string]> = {};
  for (const id of snapshot.nodes.ids) {
    const node = getEntity(snapshot.nodes, id);
    if (node === undefined) continue;
    projectedNodes[String(id)] =
      node.kind === "split"
        ? {
            kind: "split",
            id: String(node.id),
            axis: node.axis,
            childIds: node.children.map(String),
            weights: node.weights,
          }
        : {
            kind: "group",
            id: String(node.id),
            groupId: String(node.groupId),
          };
  }

  const projectedGroups: Record<string, WorkspaceProjection["groups"][string]> = {};
  for (const id of snapshot.groups.ids) {
    const group = getEntity(snapshot.groups, id);
    if (group === undefined) continue;
    projectedGroups[String(id)] = {
      id: String(group.id),
      panelIds: group.panelIds.map(String),
      selectedPanelId: String(group.selectedPanelId),
      label: groupLabels[String(group.id)] ?? group.region ?? "Panel group",
    };
  }

  const projectedPanels: Record<string, WorkspaceProjection["panels"][string]> = {};
  for (const id of snapshot.panels.ids) {
    const item = getEntity(snapshot.panels, id);
    if (item === undefined) continue;
    projectedPanels[String(id)] = {
      id: String(item.id),
      type: item.type,
      title: item.title ?? item.type,
      closable: item.capabilities.closable,
      floatable: item.capabilities.floatable,
      parameters: item.parameters,
    };
  }

  return {
    revision: snapshot.revision.toString(),
    rootNodeId: String(mainSurface.rootNodeId),
    nodes: projectedNodes,
    groups: projectedGroups,
    panels: projectedPanels,
    ...(snapshot.activation.activePanelId === undefined
      ? {}
      : { activePanelId: String(snapshot.activation.activePanelId) }),
    ...(snapshot.activation.activeSurfaceId === undefined
      ? {}
      : { activeSurfaceId: String(snapshot.activation.activeSurfaceId) }),
  };
}

let closedSequence = 0;

export const demoCommands: WorkspaceCommandAdapter<WorkspaceCommand> = {
  selectPanel: (id) => ({
    type: "select-panel",
    panelId: panelId(id),
    activate: true,
  }),
  activatePanel: (id) => ({
    type: "activate-panel",
    panelId: panelId(id),
    focus: "keep-focus",
  }),
  closePanel: (id) => {
    closedSequence += 1;
    return {
      type: "close-panels",
      targets: [
        {
          panelId: panelId(id),
          closedPanelId: closedPanelId(`closed-${id}-${closedSequence}`),
        },
      ],
    };
  },
  resizeSplit: (id, weights) => ({
    type: "resize-split",
    splitNodeId: nodeId(id),
    weights,
  }),
  movePanel: (id, targetGroupId) => ({
    type: "move-panel",
    panelId: panelId(id),
    target: { groupId: groupId(targetGroupId) },
    select: true,
    activate: true,
  }),
};
