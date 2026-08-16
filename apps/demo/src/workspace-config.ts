import {
  MAIN_SURFACE_CAPABILITIES,
  closedPanelId,
  createWorkspaceSnapshot,
  getEntity,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type BatchableWorkspaceCommand,
  type GroupRecord,
  type LayoutNode,
  type PanelCapabilities,
  type PanelLifecyclePolicy,
  type PanelRecord,
  type SurfaceRecord,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";
import { solveLayout, type LogicalRect } from "@panefold/geometry";
import {
  canonicalizeWorkspace,
  planGroupDropCommand,
  planPanelDropCommand,
  reduceWorkspace,
  validateWorkspace,
} from "@panefold/kernel";
import type {
  WorkspaceCommandAdapter,
  WorkspaceGroupDropRequest,
  WorkspaceGroupDropPlan,
  WorkspaceGroupDropPlanContext,
  WorkspacePanelDropRequest,
  WorkspacePanelDropPlan,
  WorkspacePanelDropPlanContext,
  WorkspaceProjection,
} from "@panefold/react";

const capabilities: PanelCapabilities = {
  closable: true,
  floatable: true,
  popout: true,
  pictureInPicture: false,
  singleton: true,
};

const lifecycle: PanelLifecyclePolicy = {
  hidden: "suspend",
  sameDocumentMove: "preserve-host",
  crossDocumentMove: "portal-coupled",
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
  panel("route-explorer", "map.route-explorer", "Explorer", {
    hardMinInline: 180,
    preferredInline: 250,
  }),
  panel("layers", "map.layers", "Search", {
    hardMinInline: 180,
    preferredInline: 250,
  }),
  panel("map-canvas", "map.canvas", "App.tsx", {
    hardMinInline: 320,
    hardMinBlock: 220,
    preferredInline: 900,
    preferredBlock: 650,
    resizeDelivery: "adaptive",
  }),
  panel("notes", "map.notes", "workspace.ts", {
    hardMinInline: 240,
    hardMinBlock: 160,
  }),
  panel("feature-inspector", "map.inspector", "Outline", {
    hardMinInline: 230,
    preferredInline: 310,
  }),
  panel("validation", "map.validation", "Source Control", {
    hardMinInline: 230,
    preferredInline: 310,
  }),
  panel("problems", "map.problems", "Terminal", {
    hardMinBlock: 130,
    preferredBlock: 220,
    resizeDelivery: "throttled",
  }),
  panel("timeline", "map.timeline", "Problems", {
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
  applicationLayoutVersion: 2,
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
    name: "panefold-demo",
    locale: "en-US",
    product: "Panefold Code",
  },
});

const groupLabels: Readonly<Record<string, string>> = {
  navigation: "Primary Side Bar",
  primary: "Editor Group",
  inspector: "Secondary Side Bar",
  output: "Panel",
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

  const floatingSurfaces = snapshot.floatingOrder.flatMap((id) => {
    const surface = getEntity(snapshot.surfaces, id);
    return surface?.kind === "floating" && surface.bounds !== undefined
      ? [{ ...surface, bounds: surface.bounds }]
      : [];
  });
  const reachableNodeIds = [
    mainSurface.rootNodeId,
    ...floatingSurfaces.map((item) => item.rootNodeId),
  ]
    .flatMap((rootNodeId) => collectReachableNodeIds(snapshot, rootNodeId))
    .filter((id, index, all) => all.indexOf(id) === index);
  const reachableGroupIds = new Set<string>();
  const projectedNodes: Record<string, WorkspaceProjection["nodes"][string]> = {};
  for (const id of reachableNodeIds) {
    const node = getEntity(snapshot.nodes, id);
    if (node === undefined) continue;
    if (node.kind === "group") reachableGroupIds.add(String(node.groupId));
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
    if (!reachableGroupIds.has(String(id))) continue;
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
      lifecyclePolicy: item.lifecycle,
    };
  }

  return {
    revision: snapshot.revision.toString(),
    rootNodeId: String(mainSurface.rootNodeId),
    nodes: projectedNodes,
    groups: projectedGroups,
    panels: projectedPanels,
    floatingSurfaces: floatingSurfaces.map((surface) => ({
      id: String(surface.id),
      rootNodeId: String(surface.rootNodeId),
      bounds: surface.bounds,
      maximized: surface.maximized,
      ...(surface.minimized === undefined ? {} : { minimized: surface.minimized }),
    })),
    ...(snapshot.activation.activePanelId === undefined
      ? {}
      : { activePanelId: String(snapshot.activation.activePanelId) }),
    ...(snapshot.activation.activeSurfaceId === undefined
      ? {}
      : { activeSurfaceId: String(snapshot.activation.activeSurfaceId) }),
  };
}

let closedSequence = 0;

export function createDemoCommands(
  getSnapshot: () => WorkspaceSnapshot,
): WorkspaceCommandAdapter<WorkspaceCommand> {
  return {
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
    reorderPanel: (id, targetGroupId, placement) => ({
      type: "reorder-panels",
      groupId: groupId(targetGroupId),
      panelIds: [panelId(id)],
      ...(placement.beforePanelId === undefined
        ? {}
        : { beforePanelId: panelId(placement.beforePanelId) }),
      ...(placement.afterPanelId === undefined
        ? {}
        : { afterPanelId: panelId(placement.afterPanelId) }),
    }),
    movePanel: (id, targetGroupId) => ({
      type: "move-panel",
      panelId: panelId(id),
      target: { groupId: groupId(targetGroupId) },
      select: true,
      activate: true,
    }),
    mergeGroup: (sourceGroupId, targetGroupId, selectedPanelId) => {
      const merge: WorkspaceCommand = {
        type: "merge-groups",
        sourceGroupId: groupId(sourceGroupId),
        target: { groupId: groupId(targetGroupId) },
      };
      return selectedPanelId === undefined
        ? merge
        : {
            type: "batch",
            commands: [
              merge,
              {
                type: "select-panel",
                panelId: panelId(selectedPanelId),
                activate: true,
              },
            ],
          };
    },
    floatPanel: (id) => createDemoFloatPanelCommand(getSnapshot(), id),
    moveFloatingSurface: (id, position) =>
      createDemoFloatingBatch(getSnapshot(), id, [
        { type: "move-floating-surface", surfaceId: surfaceId(id), ...position },
      ]),
    resizeFloatingSurface: (id, bounds) =>
      createDemoFloatingBatch(getSnapshot(), id, [
        { type: "resize-floating-surface", surfaceId: surfaceId(id), bounds },
      ]),
    raiseFloatingSurface: (id) => createDemoFloatingBatch(getSnapshot(), id, []),
    maximizeFloatingSurface: (id) =>
      createDemoFloatingBatch(getSnapshot(), id, [
        { type: "maximize-surface", surfaceId: surfaceId(id) },
      ]),
    restoreFloatingSurface: (id) =>
      createDemoFloatingBatch(getSnapshot(), id, [
        { type: "restore-surface", surfaceId: surfaceId(id) },
      ]),
    minimizeFloatingSurface: (id) => ({
      type: "minimize-surface",
      surfaceId: surfaceId(id),
    }),
    redockFloatingSurface: (id) => ({
      type: "redock-surface",
      surfaceId: surfaceId(id),
      target: { groupId: demoRedockTarget(getSnapshot()) },
    }),
    planPanelDrop: (request, context) => planDemoPanelDrop(getSnapshot(), request, context),
    planGroupDrop: (request, context) => planDemoGroupDrop(getSnapshot(), request, context),
  };
}

function createDemoFloatingBatch(
  snapshot: WorkspaceSnapshot,
  surfaceIdValue: string,
  commands: readonly BatchableWorkspaceCommand[],
): WorkspaceCommand {
  const selectedPanelId = demoFloatingSelectedPanel(snapshot, surfaceIdValue);
  return {
    type: "batch",
    commands: [
      ...commands,
      { type: "raise-surface", surfaceId: surfaceId(surfaceIdValue) },
      ...(selectedPanelId === undefined
        ? []
        : [
            {
              type: "activate-panel" as const,
              panelId: selectedPanelId,
              focus: "keep-focus" as const,
            },
          ]),
    ],
  };
}

function demoFloatingSelectedPanel(snapshot: WorkspaceSnapshot, surfaceIdValue: string) {
  const surface = getEntity(snapshot.surfaces, surfaceId(surfaceIdValue));
  if (surface?.kind !== "floating") return undefined;
  for (const id of collectReachableNodeIds(snapshot, surface.rootNodeId)) {
    const node = getEntity(snapshot.nodes, id);
    if (node?.kind !== "group") continue;
    return getEntity(snapshot.groups, node.groupId)?.selectedPanelId;
  }
  return undefined;
}

function createDemoFloatPanelCommand(
  snapshot: WorkspaceSnapshot,
  panelIdValue: string,
): WorkspaceCommand {
  const sourceGroup = snapshot.groups.ids
    .map((id) => getEntity(snapshot.groups, id))
    .find((group) => group?.panelIds.includes(panelId(panelIdValue)));
  const ids = allocateFloatingIds(snapshot, panelIdValue);
  const offset = snapshot.floatingOrder.length * 28;
  const bounds = {
    x: 48 + (offset % 224),
    y: 42 + (offset % 168),
    width: 480,
    height: 340,
  };
  if (sourceGroup === undefined || sourceGroup.panelIds.length <= 1) {
    return {
      type: "create-floating-surface",
      groupId: sourceGroup?.id ?? groupId(`missing:${panelIdValue}`),
      surfaceId: ids.surface,
      bounds,
    };
  }
  return {
    type: "batch",
    commands: [
      {
        type: "split-group",
        targetGroupId: sourceGroup.id,
        panelIds: [panelId(panelIdValue)],
        newGroupId: ids.group,
        newGroupNodeId: ids.groupNode,
        splitNodeId: ids.splitNode,
        edge: "inline-end",
        ratio: 0.5,
        ...(sourceGroup.region === undefined ? {} : { region: sourceGroup.region }),
      },
      {
        type: "create-floating-surface",
        groupId: ids.group,
        surfaceId: ids.surface,
        bounds,
      },
    ],
  };
}

function demoRedockTarget(snapshot: WorkspaceSnapshot) {
  const mainSurface = snapshot.surfaces.ids
    .map((id) => getEntity(snapshot.surfaces, id))
    .find((surface) => surface?.kind === "main");
  if (mainSurface === undefined) return groupId("primary");
  const groups = collectReachableNodeIds(snapshot, mainSurface.rootNodeId).flatMap((id) => {
    const node = getEntity(snapshot.nodes, id);
    return node?.kind === "group" ? [node.groupId] : [];
  });
  return groups.find((id) => String(id) === "primary") ?? groups[0] ?? groupId("primary");
}

function allocateFloatingIds(snapshot: WorkspaceSnapshot, panelIdValue: string) {
  for (let candidate = 1; candidate < Number.MAX_SAFE_INTEGER; candidate += 1) {
    const suffix = `${panelIdValue}:${String(candidate)}`;
    const group = groupId(`float-group:${suffix}`);
    const groupNode = nodeId(`float-node:${suffix}`);
    const splitNode = nodeId(`float-split:${suffix}`);
    const surface = surfaceId(`floating:${suffix}`);
    if (
      getEntity(snapshot.groups, group) === undefined &&
      getEntity(snapshot.nodes, groupNode) === undefined &&
      getEntity(snapshot.nodes, splitNode) === undefined &&
      getEntity(snapshot.surfaces, surface) === undefined
    ) {
      return Object.freeze({ group, groupNode, splitNode, surface });
    }
  }
  throw new Error(`No floating identity remains available for panel ${panelIdValue}`);
}

function planDemoPanelDrop(
  snapshot: WorkspaceSnapshot,
  request: WorkspacePanelDropRequest,
  context: WorkspacePanelDropPlanContext,
): WorkspacePanelDropPlan<WorkspaceCommand> | undefined {
  if (request.revision !== snapshot.revision.toString()) return undefined;
  const ids = allocateDropIds(snapshot, request.panel.id);
  const plan = planPanelDropCommand(
    snapshot,
    {
      panelId: panelId(request.panel.id),
      target:
        request.target.kind === "center"
          ? { kind: "center", groupId: groupId(request.targetGroup.id) }
          : {
              kind: "edge",
              groupId: groupId(request.targetGroup.id),
              edge: request.target.edge,
              ratio: request.target.ratio,
            },
    },
    {
      newGroupId: ids.group,
      newGroupNodeId: ids.groupNode,
      splitNodeId: ids.splitNode,
    },
  );
  if (!plan.ok) return undefined;

  return previewDemoDrop(
    snapshot,
    plan.command,
    (next) => {
      const resultingGroups = next.groups.ids
        .map((id) => getEntity(next.groups, id))
        .filter((group) => group?.panelIds.includes(panelId(request.panel.id)));
      return resultingGroups.length === 1 ? resultingGroups[0] : undefined;
    },
    context,
  );
}

function planDemoGroupDrop(
  snapshot: WorkspaceSnapshot,
  request: WorkspaceGroupDropRequest,
  context: WorkspaceGroupDropPlanContext,
): WorkspaceGroupDropPlan<WorkspaceCommand> | undefined {
  if (request.revision !== snapshot.revision.toString()) return undefined;
  const plan = planGroupDropCommand(
    snapshot,
    {
      groupId: groupId(request.sourceGroup.id),
      target:
        request.target.kind === "swap"
          ? { kind: "swap", groupId: groupId(request.targetGroup.id) }
          : {
              kind: "edge",
              groupId: groupId(request.targetGroup.id),
              edge: request.target.edge,
              ratio: request.target.ratio,
            },
    },
    { splitNodeId: allocateGroupDropSplitId(snapshot, request.sourceGroup.id) },
  );
  if (!plan.ok) return undefined;
  return previewDemoDrop(
    snapshot,
    plan.command,
    (next) => getEntity(next.groups, groupId(request.sourceGroup.id)),
    context,
  );
}

function previewDemoDrop<TCommand extends WorkspaceCommand>(
  snapshot: WorkspaceSnapshot,
  command: TCommand,
  findResultingGroup: (snapshot: WorkspaceSnapshot) => GroupRecord | undefined,
  context: {
    readonly bounds: LogicalRect;
    readonly splitterSize: number;
  },
): { readonly command: TCommand; readonly previewRect: LogicalRect } | undefined {
  // Preview the exact semantic command retained for pointerup. Reducing and
  // canonicalizing against the same immutable revision mirrors kernel
  // execution without dispatching or mutating the live runtime.
  const reduced = reduceWorkspace(snapshot, command);
  if (!reduced.ok) return undefined;
  const next = canonicalizeWorkspace(reduced.snapshot).snapshot;
  if (validateWorkspace(next).length > 0) return undefined;
  const resultingGroup = findResultingGroup(next);
  if (resultingGroup === undefined) return undefined;
  const resultingNode = next.nodes.ids
    .map((id) => getEntity(next.nodes, id))
    .find((node) => node?.kind === "group" && node.groupId === resultingGroup.id);
  const resultingSurface = next.surfaces.ids
    .map((id) => getEntity(next.surfaces, id))
    .find(
      (surface) =>
        surface !== undefined &&
        resultingNode !== undefined &&
        collectReachableNodeIds(next, surface.rootNodeId).includes(resultingNode.id),
    );
  if (resultingSurface === undefined) return undefined;
  const layout = solveLayout(next, resultingSurface.rootNodeId, context.bounds, {
    splitterSize: context.splitterSize,
  });
  const previewRect = layout.groupRects[String(resultingGroup.id)];
  if (previewRect === undefined) return undefined;
  return Object.freeze({ command, previewRect: Object.freeze({ ...previewRect }) });
}

/**
 * Derives placement IDs from the authoritative snapshot instead of module
 * lifetime. The demo can therefore reload a persisted split and immediately
 * split the same panel again without reusing the IDs produced before reload.
 */
function allocateDropIds(snapshot: WorkspaceSnapshot, panelIdValue: string) {
  for (let candidate = 1; candidate < Number.MAX_SAFE_INTEGER; candidate += 1) {
    const suffix = `${panelIdValue}:${String(candidate)}`;
    const group = groupId(`drag-group:${suffix}`);
    const groupNode = nodeId(`drag-node:${suffix}`);
    const splitNode = nodeId(`drag-split:${suffix}`);
    if (
      getEntity(snapshot.groups, group) === undefined &&
      getEntity(snapshot.nodes, groupNode) === undefined &&
      getEntity(snapshot.nodes, splitNode) === undefined
    ) {
      return Object.freeze({ group, groupNode, splitNode });
    }
  }
  throw new Error(`No placement identity remains available for panel ${panelIdValue}`);
}

function allocateGroupDropSplitId(snapshot: WorkspaceSnapshot, groupIdValue: string) {
  for (let candidate = 1; candidate < Number.MAX_SAFE_INTEGER; candidate += 1) {
    const splitNodeId = nodeId(`group-drag-split:${groupIdValue}:${String(candidate)}`);
    if (getEntity(snapshot.nodes, splitNodeId) === undefined) return splitNodeId;
  }
  throw new Error(`No group-drop identity remains available for group ${groupIdValue}`);
}

function collectReachableNodeIds(
  snapshot: WorkspaceSnapshot,
  rootNodeId: LayoutNode["id"],
): readonly LayoutNode["id"][] {
  const result: LayoutNode["id"][] = [];
  const pending = [rootNodeId];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(String(current))) continue;
    seen.add(String(current));
    const node = getEntity(snapshot.nodes, current);
    if (node === undefined) continue;
    result.push(node.id);
    if (node.kind === "split") pending.push(...node.children);
  }
  return result;
}
