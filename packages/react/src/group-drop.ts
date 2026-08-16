import {
  containsPoint,
  createDropTargets,
  type LogicalPoint,
  type LogicalRect,
  type ResolvedLayout,
} from "@panefold/geometry";

import {
  emptyGroupAcquisitionRect,
  groupLabel,
  logicalEdgeLabel,
  nodeForGroup,
  panelsForGroup,
  subtreeContainsNode,
  surfaceLayoutBoundsForNode,
} from "./panel-drop";
import type { WorkspacePhysicalEdge } from "./messages";
import type {
  WorkspaceDirection,
  WorkspaceGroupDropPlan,
  WorkspaceGroupDropPlanContext,
  WorkspaceGroupDropRequest,
  WorkspaceGroupView,
  WorkspaceLogicalEdge,
  WorkspacePanelView,
  WorkspaceProjection,
} from "./types";

export interface GroupDropLabels {
  readonly swapPanelContainers: (values: {
    readonly source: string;
    readonly target: string;
  }) => string;
  readonly movePanelContainerBeside: (values: {
    readonly source: string;
    readonly edge: WorkspacePhysicalEdge;
    readonly target: string;
  }) => string;
}

export interface GroupDropCandidate<TCommand = unknown> {
  readonly id: string;
  readonly label: string;
  /** Compact acquisition zone used only to choose a destination. */
  readonly hitRect: LogicalRect;
  /** Application-planned exact resulting source-container geometry. */
  readonly previewRect: LogicalRect;
  readonly request: WorkspaceGroupDropRequest;
  readonly plan: WorkspaceGroupDropPlan<TCommand>;
  readonly acquisitionPriority: number;
  /** Main is zero; same-document floating surfaces follow back-to-front array order. */
  readonly surfacePriority: number;
}

export function createGroupDropRequest(
  projection: WorkspaceProjection,
  sourceGroupId: string,
  targetGroupId: string,
  targetNodeId: string,
  target:
    | { readonly kind: "swap" }
    | {
        readonly kind: "edge";
        readonly edge: WorkspaceLogicalEdge;
        readonly ratio: number;
      },
): WorkspaceGroupDropRequest | undefined {
  const sourceGroup = projection.groups[sourceGroupId];
  const sourceNodeId = nodeForGroup(projection, sourceGroupId);
  const targetGroup = projection.groups[targetGroupId];
  if (
    sourceGroup === undefined ||
    sourceNodeId === undefined ||
    targetGroup === undefined ||
    sourceGroup.id === targetGroup.id
  ) {
    return undefined;
  }
  return freezeGroupDropRequest({
    revision: projection.revision,
    sourceGroup,
    sourcePanels: panelsForGroup(projection, sourceGroup),
    sourceNodeId,
    targetGroup,
    targetPanels: panelsForGroup(projection, targetGroup),
    targetNodeId,
    target,
  });
}

export function createGroupDropCandidates<TCommand = unknown>(
  projection: WorkspaceProjection,
  layout: ResolvedLayout,
  sourceGroupId: string,
  direction: WorkspaceDirection,
  edgeRatio = 0.25,
  moveRatio = 0.5,
  splitterSize = 6,
  labels: GroupDropLabels = DEFAULT_GROUP_DROP_LABELS,
  planDrop?: (
    request: WorkspaceGroupDropRequest,
    context: WorkspaceGroupDropPlanContext,
  ) => WorkspaceGroupDropPlan<TCommand> | undefined,
): readonly GroupDropCandidate<TCommand>[] {
  const sourceGroup = projection.groups[sourceGroupId];
  if (sourceGroup === undefined || sourceGroup.panelIds.length === 0) return [];
  const fallbackBounds = layout.nodeRects[layout.rootNodeId];
  if (fallbackBounds === undefined) return [];
  const candidates: GroupDropCandidate<TCommand>[] = [];

  for (const node of Object.values(projection.nodes)) {
    if (node.kind !== "group" || node.groupId === sourceGroup.id) continue;
    const targetGroup = projection.groups[node.groupId];
    const targetRect = layout.groupRects[node.groupId];
    if (targetGroup === undefined || targetRect === undefined) continue;
    const bounds = surfaceLayoutBoundsForNode(projection, layout, node.id) ?? fallbackBounds;
    const surfacePriority = groupDropSurfacePriority(projection, node.id);
    const acquisitionRect = emptyGroupAcquisitionRect(targetGroup, targetRect, bounds);
    if (acquisitionRect.inlineSize <= 0 || acquisitionRect.blockSize <= 0) continue;

    // A retained empty target may solve to a sliver. Swapping remains useful,
    // while advertising four overlapping edge moves would not be operable.
    if (targetGroup.panelIds.length === 0) {
      appendCandidate(
        candidates,
        projection,
        sourceGroup,
        targetGroup,
        node.id,
        { kind: "swap" },
        acquisitionRect,
        targetRect,
        bounds,
        splitterSize,
        direction,
        labels,
        planDrop,
        1,
        surfacePriority,
      );
      continue;
    }

    for (const target of createDropTargets(node.id, targetRect, edgeRatio)) {
      if (target.kind === "inside") {
        appendCandidate(
          candidates,
          projection,
          sourceGroup,
          targetGroup,
          node.id,
          { kind: "swap" },
          target.rect,
          targetRect,
          bounds,
          splitterSize,
          direction,
          labels,
          planDrop,
          0,
          surfacePriority,
        );
      } else {
        appendCandidate(
          candidates,
          projection,
          sourceGroup,
          targetGroup,
          node.id,
          { kind: "edge", edge: target.edge, ratio: clampRatio(moveRatio) },
          target.rect,
          targetRect,
          bounds,
          splitterSize,
          direction,
          labels,
          planDrop,
          0,
          surfacePriority,
        );
      }
    }
  }

  return Object.freeze(candidates);
}

function appendCandidate<TCommand>(
  candidates: GroupDropCandidate<TCommand>[],
  projection: WorkspaceProjection,
  sourceGroup: WorkspaceGroupView,
  targetGroup: WorkspaceGroupView,
  targetNodeId: string,
  target: WorkspaceGroupDropRequest["target"],
  hitRect: LogicalRect,
  targetRect: LogicalRect,
  bounds: LogicalRect,
  splitterSize: number,
  direction: WorkspaceDirection,
  labels: GroupDropLabels,
  planDrop:
    | ((
        request: WorkspaceGroupDropRequest,
        context: WorkspaceGroupDropPlanContext,
      ) => WorkspaceGroupDropPlan<TCommand> | undefined)
    | undefined,
  acquisitionPriority: number,
  surfacePriority: number,
): void {
  const request = createGroupDropRequest(
    projection,
    sourceGroup.id,
    targetGroup.id,
    targetNodeId,
    target,
  );
  if (request === undefined) return;
  const plan = planGroupDrop(planDrop, request, targetRect, bounds, splitterSize);
  if (plan === undefined) return;
  const sourceLabel = groupLabel(sourceGroup);
  const targetLabel = groupLabel(targetGroup);
  const label =
    target.kind === "swap"
      ? labels.swapPanelContainers({ source: sourceLabel, target: targetLabel })
      : labels.movePanelContainerBeside({
          source: sourceLabel,
          edge: logicalEdgeLabel(target.edge, direction),
          target: targetLabel,
        });
  candidates.push(
    Object.freeze({
      id: target.kind === "swap" ? `swap:${targetNodeId}` : `edge:${targetNodeId}:${target.edge}`,
      label,
      hitRect: Object.freeze({ ...hitRect }),
      previewRect: plan.previewRect,
      request,
      plan,
      acquisitionPriority,
      surfacePriority,
    }),
  );
}

export function planGroupDrop<TCommand>(
  planner:
    | ((
        request: WorkspaceGroupDropRequest,
        context: WorkspaceGroupDropPlanContext,
      ) => WorkspaceGroupDropPlan<TCommand> | undefined)
    | undefined,
  request: WorkspaceGroupDropRequest,
  targetRect: LogicalRect,
  bounds: LogicalRect,
  splitterSize: number,
): WorkspaceGroupDropPlan<TCommand> | undefined {
  if (planner === undefined) return undefined;
  const context = Object.freeze({
    bounds: Object.freeze({ ...bounds }),
    targetRect: Object.freeze({ ...targetRect }),
    splitterSize: Number.isFinite(splitterSize) && splitterSize >= 0 ? Math.round(splitterSize) : 6,
  });
  try {
    const planned = planner(freezeGroupDropRequest(request), context);
    if (planned === undefined || !validPreviewRect(planned.previewRect, bounds)) return undefined;
    return Object.freeze({
      command: planned.command,
      previewRect: Object.freeze({ ...planned.previewRect }),
    });
  } catch {
    return undefined;
  }
}

export function hitTestGroupDropCandidates<TCommand>(
  candidates: readonly GroupDropCandidate<TCommand>[],
  point: LogicalPoint,
): GroupDropCandidate<TCommand> | undefined {
  let swap: GroupDropCandidate<TCommand> | undefined;
  let edge: GroupDropCandidate<TCommand> | undefined;
  let edgeCandidateDistance = Number.POSITIVE_INFINITY;
  let surfacePriority = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (!containsPoint(candidate.hitRect, point) || candidate.surfacePriority < surfacePriority) {
      continue;
    }
    if (candidate.surfacePriority > surfacePriority) {
      surfacePriority = candidate.surfacePriority;
      swap = undefined;
      edge = undefined;
      edgeCandidateDistance = Number.POSITIVE_INFINITY;
    }
    if (candidate.request.target.kind === "swap") {
      if (swap === undefined || compareSwapCandidate(candidate, swap) < 0) swap = candidate;
      continue;
    }
    const distance = edgeDistance(candidate, point);
    if (
      edge === undefined ||
      distance < edgeCandidateDistance ||
      (distance === edgeCandidateDistance && compareCodeUnits(candidate.id, edge.id) < 0)
    ) {
      edge = candidate;
      edgeCandidateDistance = distance;
    }
  }
  return swap ?? edge;
}

function compareSwapCandidate<TCommand>(
  left: GroupDropCandidate<TCommand>,
  right: GroupDropCandidate<TCommand>,
): number {
  return (
    right.acquisitionPriority - left.acquisitionPriority ||
    left.hitRect.inlineSize * left.hitRect.blockSize -
      right.hitRect.inlineSize * right.hitRect.blockSize ||
    compareCodeUnits(left.id, right.id)
  );
}

function edgeDistance(candidate: GroupDropCandidate, point: LogicalPoint): number {
  const target = candidate.request.target;
  if (target.kind !== "edge") return Number.POSITIVE_INFINITY;
  const rect = candidate.hitRect;
  if (target.edge === "inline-start") return Math.abs(point.inline - rect.inlineStart);
  if (target.edge === "inline-end") {
    return Math.abs(rect.inlineStart + rect.inlineSize - point.inline);
  }
  if (target.edge === "block-start") return Math.abs(point.block - rect.blockStart);
  return Math.abs(rect.blockStart + rect.blockSize - point.block);
}

function groupDropSurfacePriority(projection: WorkspaceProjection, nodeId: string): number {
  const floatingSurfaces = projection.floatingSurfaces ?? [];
  for (let index = floatingSurfaces.length - 1; index >= 0; index -= 1) {
    const surface = floatingSurfaces[index];
    if (surface !== undefined && subtreeContainsNode(projection, surface.rootNodeId, nodeId)) {
      return index + 1;
    }
  }
  return 0;
}

function validPreviewRect(rect: LogicalRect, bounds: LogicalRect): boolean {
  return (
    [rect.inlineStart, rect.blockStart, rect.inlineSize, rect.blockSize].every(Number.isFinite) &&
    rect.inlineSize >= 0 &&
    rect.blockSize >= 0 &&
    rect.inlineStart >= bounds.inlineStart &&
    rect.blockStart >= bounds.blockStart &&
    rect.inlineStart + rect.inlineSize <= bounds.inlineStart + bounds.inlineSize &&
    rect.blockStart + rect.blockSize <= bounds.blockStart + bounds.blockSize
  );
}

function freezeGroupDropRequest(request: WorkspaceGroupDropRequest): WorkspaceGroupDropRequest {
  const copyPanel = (panel: WorkspacePanelView) => Object.freeze({ ...panel });
  const copyGroup = (group: WorkspaceGroupView) =>
    Object.freeze({ ...group, panelIds: Object.freeze([...group.panelIds]) });
  return Object.freeze({
    ...request,
    sourceGroup: copyGroup(request.sourceGroup),
    sourcePanels: Object.freeze(request.sourcePanels.map(copyPanel)),
    targetGroup: copyGroup(request.targetGroup),
    targetPanels: Object.freeze(request.targetPanels.map(copyPanel)),
    target: Object.freeze({ ...request.target }),
  });
}

function clampRatio(value: number): number {
  return Number.isFinite(value) ? Math.min(0.9, Math.max(0.1, value)) : 0.5;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const DEFAULT_GROUP_DROP_LABELS: GroupDropLabels = Object.freeze({
  swapPanelContainers: ({ source, target }: { readonly source: string; readonly target: string }) =>
    `Swap ${source} and ${target} panel containers`,
  movePanelContainerBeside: ({
    source,
    edge,
    target,
  }: {
    readonly source: string;
    readonly edge: WorkspacePhysicalEdge;
    readonly target: string;
  }) =>
    `Move ${source} ${edge === "left" || edge === "right" ? `${edge} of ${target}` : `${edge} ${target}`}`,
});
