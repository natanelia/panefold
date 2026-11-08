import { solveLayout, type LogicalRect } from "@panefold/geometry";
import {
  canonicalizeWorkspace,
  planGroupDropCommand,
  planPanelDropCommand,
  reduceWorkspace,
  validateWorkspace,
} from "@panefold/kernel";
import {
  closedPanelId,
  cloneAndFreeze,
  getEntity,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type BatchableWorkspaceCommand,
  type GroupRecord,
  type LayoutNode,
  type Rect,
  type TabPlacement,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";
import type {
  WorkspaceCommandAdapter,
  WorkspaceGroupDropRequest,
  WorkspaceGroupDropPlan,
  WorkspaceGroupDropPlanContext,
  WorkspacePanelDropRequest,
  WorkspacePanelDropPlan,
  WorkspacePanelDropPlanContext,
  WorkspaceProjection,
} from "./types";

/** Application policy remains explicit; defaults contain no reference-app IDs or labels. */
export interface ModelWorkspaceOptions {
  readonly groupLabel?: (group: GroupRecord, snapshot: WorkspaceSnapshot) => string;
  /** Use the same model solver for previews and committed layout. Defaults to solveLayout. */
  readonly solveLayout?: typeof solveLayout;
  readonly floatingBounds?: (panelId: string, snapshot: WorkspaceSnapshot) => Rect;
  /** Defaults to the first docked group in main-surface document order. */
  readonly redockTarget?: (surfaceId: string, snapshot: WorkspaceSnapshot) => TabPlacement;
  /**
   * Override an individual command policy without copying the whole adapter.
   * Default drop previews use pure kernel semantics. A runtime policy that
   * transforms placement commands must supply matching drop planners here.
   */
  readonly commands?: Partial<WorkspaceCommandAdapter<WorkspaceCommand>>;
}

export function projectModelWorkspace(
  snapshot: WorkspaceSnapshot,
  options: ModelWorkspaceOptions = {},
): WorkspaceProjection {
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
  const projectedNodes = Object.create(null) as Record<
    string,
    WorkspaceProjection["nodes"][string]
  >;
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

  const projectedGroups = Object.create(null) as Record<
    string,
    WorkspaceProjection["groups"][string]
  >;
  for (const id of snapshot.groups.ids) {
    if (!reachableGroupIds.has(String(id))) continue;
    const group = getEntity(snapshot.groups, id);
    if (group === undefined) continue;
    projectedGroups[String(id)] = {
      id: String(group.id),
      panelIds: group.panelIds.map(String),
      selectedPanelId: String(group.selectedPanelId),
      label: options.groupLabel?.(group, snapshot) ?? group.region ?? "Panel group",
    };
  }

  const projectedPanels = Object.create(null) as Record<
    string,
    WorkspaceProjection["panels"][string]
  >;
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
      ...(item.constraints.resizeDelivery === undefined
        ? {}
        : { resizeDelivery: item.constraints.resizeDelivery }),
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

export function createModelWorkspaceCommands(
  getSnapshot: () => WorkspaceSnapshot,
  options: ModelWorkspaceOptions = {},
): WorkspaceCommandAdapter<WorkspaceCommand> {
  let closedSequence = 0;
  const modelSolver = options.solveLayout ?? solveLayout;
  const commands: WorkspaceCommandAdapter<WorkspaceCommand> = {
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
      const occupied = new Set(
        getSnapshot().recoverableClosedPanels.map((item) => String(item.id)),
      );
      let closedId: string;
      do {
        if (closedSequence === Number.MAX_SAFE_INTEGER) {
          throw new Error("The workspace command adapter has exhausted its close identities");
        }
        closedSequence += 1;
        closedId = `panefold:closed:${id}:${String(closedSequence)}`;
      } while (occupied.has(closedId));
      return {
        type: "close-panels",
        targets: [
          {
            panelId: panelId(id),
            closedPanelId: closedPanelId(closedId),
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
    mergeGroup: createMergeGroupCommand,
    floatPanel: (id) => createFloatPanelCommand(getSnapshot(), id, options),
    moveFloatingSurface: (id, position) =>
      createFloatingBatch(getSnapshot(), id, [
        { type: "move-floating-surface", surfaceId: surfaceId(id), ...position },
      ]),
    resizeFloatingSurface: (id, bounds) =>
      createFloatingBatch(getSnapshot(), id, [
        { type: "resize-floating-surface", surfaceId: surfaceId(id), bounds },
      ]),
    raiseFloatingSurface: (id) => createFloatingBatch(getSnapshot(), id, []),
    maximizeFloatingSurface: (id) =>
      createFloatingBatch(getSnapshot(), id, [
        { type: "maximize-surface", surfaceId: surfaceId(id) },
      ]),
    restoreFloatingSurface: (id) =>
      createFloatingBatch(getSnapshot(), id, [
        { type: "restore-surface", surfaceId: surfaceId(id) },
      ]),
    minimizeFloatingSurface: (id) => ({
      type: "minimize-surface",
      surfaceId: surfaceId(id),
    }),
    redockFloatingSurface: (id) => {
      const snapshot = getSnapshot();
      return {
        type: "redock-surface",
        surfaceId: surfaceId(id),
        target: options.redockTarget?.(id, snapshot) ?? { groupId: defaultRedockTarget(snapshot) },
      };
    },
    planPanelDrop: (request, context) =>
      planModelPanelDrop(getSnapshot(), request, context, modelSolver),
    planPanelTabDrop: (request, context) =>
      planModelPanelDrop(getSnapshot(), request, context, modelSolver),
    planGroupDrop: (request, context) =>
      planModelGroupDrop(getSnapshot(), request, context, modelSolver),
  };
  return Object.freeze({ ...commands, ...options.commands });
}

function createFloatingBatch(
  snapshot: WorkspaceSnapshot,
  surfaceIdValue: string,
  commands: readonly BatchableWorkspaceCommand[],
): WorkspaceCommand {
  const selectedPanelId = floatingSelectedPanel(snapshot, surfaceIdValue);
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

function floatingSelectedPanel(snapshot: WorkspaceSnapshot, surfaceIdValue: string) {
  const surface = getEntity(snapshot.surfaces, surfaceId(surfaceIdValue));
  if (surface?.kind !== "floating") return undefined;
  for (const id of collectReachableNodeIds(snapshot, surface.rootNodeId)) {
    const node = getEntity(snapshot.nodes, id);
    if (node?.kind !== "group") continue;
    return getEntity(snapshot.groups, node.groupId)?.selectedPanelId;
  }
  return undefined;
}

function createFloatPanelCommand(
  snapshot: WorkspaceSnapshot,
  panelIdValue: string,
  options: ModelWorkspaceOptions,
): WorkspaceCommand {
  const sourceGroup = snapshot.groups.ids
    .map((id) => getEntity(snapshot.groups, id))
    .find((group) => group?.panelIds.includes(panelId(panelIdValue)));
  const ids = allocatePlacementIds(snapshot, "float", panelIdValue);
  const offset = snapshot.floatingOrder.length * 24;
  const bounds = options.floatingBounds?.(panelIdValue, snapshot) ?? {
    x: 24 + (offset % 192),
    y: 24 + (offset % 144),
    width: 480,
    height: 320,
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

function defaultRedockTarget(snapshot: WorkspaceSnapshot) {
  const mainSurface = snapshot.surfaces.ids
    .map((id) => getEntity(snapshot.surfaces, id))
    .find((surface) => surface?.kind === "main");
  if (mainSurface === undefined) throw new Error("A model workspace requires a main surface");
  const groups = collectReachableNodeIds(snapshot, mainSurface.rootNodeId).flatMap((id) => {
    const node = getEntity(snapshot.nodes, id);
    return node?.kind === "group" ? [node.groupId] : [];
  });
  const first = groups[0];
  if (first === undefined) throw new Error("The main surface has no docked group");
  return first;
}

function planModelPanelDrop(
  snapshot: WorkspaceSnapshot,
  request: WorkspacePanelDropRequest,
  context: WorkspacePanelDropPlanContext,
  modelSolver: typeof solveLayout,
): WorkspacePanelDropPlan<WorkspaceCommand> | undefined {
  if (request.revision !== snapshot.revision.toString()) return undefined;
  const ids = allocatePlacementIds(snapshot, "drop", request.panel.id);
  const plan = planPanelDropCommand(
    snapshot,
    {
      panelId: panelId(request.panel.id),
      target:
        request.target.kind === "center"
          ? {
              kind: "center",
              groupId: groupId(request.targetGroup.id),
              ...(request.target.beforePanelId === undefined
                ? {}
                : { beforePanelId: panelId(request.target.beforePanelId) }),
              ...(request.target.afterPanelId === undefined
                ? {}
                : { afterPanelId: panelId(request.target.afterPanelId) }),
            }
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

  return previewModelDrop(
    snapshot,
    plan.command,
    (next) => {
      const resultingGroups = next.groups.ids
        .map((id) => getEntity(next.groups, id))
        .filter((group) => group?.panelIds.includes(panelId(request.panel.id)));
      return resultingGroups.length === 1 ? resultingGroups[0] : undefined;
    },
    context,
    modelSolver,
  );
}

function planModelGroupDrop(
  snapshot: WorkspaceSnapshot,
  request: WorkspaceGroupDropRequest,
  context: WorkspaceGroupDropPlanContext,
  modelSolver: typeof solveLayout,
): WorkspaceGroupDropPlan<WorkspaceCommand> | undefined {
  if (request.revision !== snapshot.revision.toString()) return undefined;
  if (request.target.kind === "merge") {
    const command = createMergeGroupCommand(
      request.sourceGroup.id,
      request.targetGroup.id,
      request.sourceGroup.selectedPanelId,
    );
    return previewModelDrop(
      snapshot,
      command,
      (next) => getEntity(next.groups, groupId(request.targetGroup.id)),
      context,
      modelSolver,
    );
  }
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
    { splitNodeId: allocatePlacementIds(snapshot, "group-drop", request.sourceGroup.id).splitNode },
  );
  if (!plan.ok) return undefined;
  return previewModelDrop(
    snapshot,
    plan.command,
    (next) => getEntity(next.groups, groupId(request.sourceGroup.id)),
    context,
    modelSolver,
  );
}

function previewModelDrop<TCommand extends WorkspaceCommand>(
  snapshot: WorkspaceSnapshot,
  command: TCommand,
  findResultingGroup: (snapshot: WorkspaceSnapshot) => GroupRecord | undefined,
  context: {
    readonly bounds: LogicalRect;
    readonly splitterSize: number;
  },
  modelSolver: typeof solveLayout,
): { readonly command: TCommand; readonly previewRect: LogicalRect } | undefined {
  // Preview the exact semantic command retained for pointerup. Reducing and
  // canonicalizing against the same immutable revision mirrors kernel
  // execution without dispatching or mutating the live runtime. Application
  // dispatch policies can still reject or transform it; transforming placement
  // policies need matching planner overrides to preserve preview parity.
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
  const layout = modelSolver(next, resultingSurface.rootNodeId, context.bounds, {
    splitterSize: context.splitterSize,
  });
  const previewRect = layout.groupRects[String(resultingGroup.id)];
  if (previewRect === undefined) return undefined;
  return Object.freeze({
    command: cloneAndFreeze(command),
    previewRect: Object.freeze({ ...previewRect }),
  });
}

/**
 * Derive identities from the authoritative snapshot so repeated planning is
 * deterministic and restored layouts cannot collide with previous placements.
 * At most one candidate per occupied identity can be rejected.
 */
function allocatePlacementIds(
  snapshot: WorkspaceSnapshot,
  kind: "float" | "drop" | "group-drop",
  subject: string,
) {
  const occupied = new Set<string>([
    ...snapshot.groups.ids,
    ...snapshot.nodes.ids,
    ...snapshot.surfaces.ids,
  ]);
  for (let candidate = 1; candidate <= occupied.size + 1; candidate += 1) {
    const suffix = `${subject}:${String(candidate)}`;
    const prefix = kind === "float" ? "float" : "drag";
    const group = groupId(`${prefix}-group:${suffix}`);
    const groupNode = nodeId(`${prefix}-node:${suffix}`);
    const splitNode = nodeId(`${kind === "group-drop" ? "group-drag" : prefix}-split:${suffix}`);
    const surface = surfaceId(`floating:${suffix}`);
    if ([group, groupNode, splitNode, surface].every((id) => !occupied.has(id))) {
      return Object.freeze({ group, groupNode, splitNode, surface });
    }
  }
  throw new Error("No placement identity remains available");
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
    if (node.kind === "split") pending.push(...node.children.slice().reverse());
  }
  return result;
}

function createMergeGroupCommand(
  sourceGroupId: string,
  targetGroupId: string,
  selectedPanelId?: string,
): WorkspaceCommand {
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
}
