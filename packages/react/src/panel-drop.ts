import {
  containsPoint,
  createDropTargets,
  type LogicalPoint,
  type LogicalRect,
  type ResolvedLayout,
} from "@panefold/geometry";

import type {
  WorkspaceDirection,
  WorkspaceGroupView,
  WorkspaceLogicalEdge,
  WorkspacePanelDropRequest,
  WorkspacePanelDropPlan,
  WorkspacePanelDropPlanContext,
  WorkspacePanelView,
  WorkspaceProjection,
} from "./types";
import type { WorkspacePhysicalEdge } from "./messages";

export interface PanelDropLabels {
  readonly movedPanelTo: (values: { readonly title: string; readonly group: string }) => string;
  readonly splitPanel: (values: {
    readonly title: string;
    readonly edge: WorkspacePhysicalEdge;
    readonly group: string;
  }) => string;
}

export interface PanelDropCandidate<TCommand = unknown> {
  readonly id: string;
  readonly label: string;
  /** Compact acquisition zone used only to choose a destination. */
  readonly hitRect: LogicalRect;
  /** Application-planned commit geometry. */
  readonly previewRect: LogicalRect;
  readonly request: WorkspacePanelDropRequest;
  /** Exact application command retained from the same plan that made the preview. */
  readonly plan: WorkspacePanelDropPlan<TCommand>;
  /** Retained empty destinations sit above overlapping ordinary acquisition zones. */
  readonly acquisitionPriority: number;
}

/**
 * A retained empty group has no panel constraints and can legitimately solve
 * down to a sliver. Keep its view-only acquisition target usable without
 * changing committed topology or persisted weights.
 */
export function emptyGroupAcquisitionRect(
  group: WorkspaceGroupView,
  rect: LogicalRect,
  bounds: LogicalRect,
  minimumSize = 96,
): LogicalRect {
  if (group.panelIds.length > 0) return rect;
  return {
    ...expandAxis(
      rect.inlineStart,
      rect.inlineSize,
      bounds.inlineStart,
      bounds.inlineSize,
      minimumSize,
    ),
    ...expandBlockAxis(
      rect.blockStart,
      rect.blockSize,
      bounds.blockStart,
      bounds.blockSize,
      minimumSize,
    ),
  };
}

export function createPanelDropRequest(
  projection: WorkspaceProjection,
  panelId: string,
  targetGroupId: string,
  targetNodeId: string,
  target:
    | { readonly kind: "center"; readonly ratio: 1 }
    | {
        readonly kind: "edge";
        readonly edge: WorkspaceLogicalEdge;
        readonly ratio: number;
      },
): WorkspacePanelDropRequest | undefined {
  const panel = projection.panels[panelId];
  const sourceGroup = groupForPanel(projection, panelId);
  const targetGroup = projection.groups[targetGroupId];
  if (panel === undefined || sourceGroup === undefined || targetGroup === undefined) {
    return undefined;
  }

  return freezeDropRequest({
    revision: projection.revision,
    panel,
    sourceGroup,
    sourcePanels: panelsForGroup(projection, sourceGroup),
    targetGroup,
    targetPanels: panelsForGroup(projection, targetGroup),
    targetNodeId,
    target,
  });
}

export function createPanelDropCandidates<TCommand = unknown>(
  projection: WorkspaceProjection,
  layout: ResolvedLayout,
  panelId: string,
  direction: WorkspaceDirection,
  edgeRatio = 0.25,
  splitRatio = 0.5,
  splitterSize = 6,
  labels: PanelDropLabels = DEFAULT_PANEL_DROP_LABELS,
  planDrop?: (
    request: WorkspacePanelDropRequest,
    context: WorkspacePanelDropPlanContext,
  ) => WorkspacePanelDropPlan<TCommand> | undefined,
): readonly PanelDropCandidate<TCommand>[] {
  const sourceGroup = groupForPanel(projection, panelId);
  if (sourceGroup === undefined) return [];
  const bounds = layout.nodeRects[layout.rootNodeId];
  if (bounds === undefined) return [];
  const candidates: PanelDropCandidate<TCommand>[] = [];

  for (const node of Object.values(projection.nodes)) {
    if (node.kind !== "group") continue;
    const group = projection.groups[node.groupId];
    const rect = layout.groupRects[node.groupId];
    if (group === undefined || rect === undefined) {
      continue;
    }

    const acquisitionRect = emptyGroupAcquisitionRect(group, rect, bounds);
    if (acquisitionRect.inlineSize <= 0 || acquisitionRect.blockSize <= 0) continue;

    // Empty retained groups are destinations, not useful split anchors. Give
    // the entire visible placeholder to the center action so there is no dead
    // strip around the affordance.
    if (group.panelIds.length === 0) {
      const request = createPanelDropRequest(projection, panelId, group.id, node.id, {
        kind: "center",
        ratio: 1,
      });
      if (request === undefined) continue;
      const plan = planPanelDrop(planDrop, request, rect, layout, splitterSize);
      if (plan === undefined) continue;
      candidates.push({
        id: `center:${node.id}`,
        label: labels.movedPanelTo({
          title: request.panel.title,
          group: groupLabel(group),
        }),
        hitRect: acquisitionRect,
        previewRect: plan.previewRect,
        request,
        plan,
        acquisitionPriority: 1,
      });
      continue;
    }

    for (const target of createDropTargets(node.id, rect, edgeRatio)) {
      if (target.kind === "inside") {
        if (group.id === sourceGroup.id) continue;
        const request = createPanelDropRequest(projection, panelId, group.id, node.id, {
          kind: "center",
          ratio: 1,
        });
        if (request === undefined) continue;
        const plan = planPanelDrop(planDrop, request, rect, layout, splitterSize);
        if (plan === undefined) continue;
        candidates.push({
          id: `center:${node.id}`,
          label: labels.movedPanelTo({
            title: request.panel.title,
            group: groupLabel(group),
          }),
          hitRect: target.rect,
          previewRect: plan.previewRect,
          request,
          plan,
          acquisitionPriority: 0,
        });
        continue;
      }

      // Splitting a group's sole panel against itself would create an empty source group.
      // Other target groups remain valid even when the source has a single panel.
      if (group.id === sourceGroup.id && sourceGroup.panelIds.length <= 1) continue;
      const request = createPanelDropRequest(projection, panelId, group.id, node.id, {
        kind: "edge",
        edge: target.edge,
        ratio: clampRatio(splitRatio),
      });
      if (request === undefined) continue;
      const plan = planPanelDrop(planDrop, request, rect, layout, splitterSize);
      if (plan === undefined) continue;
      candidates.push({
        id: `edge:${node.id}:${target.edge}`,
        label: splitLabel(request.panel, group, target.edge, direction, labels.splitPanel),
        hitRect: target.rect,
        previewRect: plan.previewRect,
        request,
        plan,
        acquisitionPriority: 0,
      });
    }
  }

  return candidates;
}

export function planPanelDrop<TCommand>(
  planner:
    | ((
        request: WorkspacePanelDropRequest,
        context: WorkspacePanelDropPlanContext,
      ) => WorkspacePanelDropPlan<TCommand> | undefined)
    | undefined,
  request: WorkspacePanelDropRequest,
  targetRect: LogicalRect,
  layout: ResolvedLayout,
  splitterSize: number,
): WorkspacePanelDropPlan<TCommand> | undefined {
  if (planner === undefined) return undefined;
  const bounds = layout.nodeRects[layout.rootNodeId];
  if (bounds === undefined) return undefined;
  const context = Object.freeze({
    bounds: Object.freeze({ ...bounds }),
    targetRect: Object.freeze({ ...targetRect }),
    splitterSize: Number.isFinite(splitterSize) && splitterSize >= 0 ? Math.round(splitterSize) : 6,
  });
  try {
    const planned = planner(freezeDropRequest(request), context);
    if (planned === undefined || !validPreviewRect(planned.previewRect, bounds)) return undefined;
    return Object.freeze({
      command: planned.command,
      previewRect: Object.freeze({ ...planned.previewRect }),
    });
  } catch {
    return undefined;
  }
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

/**
 * Resolves corner overlap by choosing the closest logical edge. This remains
 * deterministic when supplied by an older geometry adapter whose edge zones
 * overlap at corners, while preserving the geometry package's center target.
 */
export function hitTestPanelDropCandidates<TCommand>(
  candidates: readonly PanelDropCandidate<TCommand>[],
  point: LogicalPoint,
): PanelDropCandidate<TCommand> | undefined {
  let center: PanelDropCandidate<TCommand> | undefined;
  let edge: PanelDropCandidate<TCommand> | undefined;
  let edgeCandidateDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!containsPoint(candidate.hitRect, point)) continue;
    if (candidate.request.target.kind === "center") {
      if (center === undefined || compareCenterCandidate(candidate, center) < 0) {
        center = candidate;
      }
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
  return center ?? edge;
}

function compareCenterCandidate<TCommand>(
  left: PanelDropCandidate<TCommand>,
  right: PanelDropCandidate<TCommand>,
): number {
  return (
    right.acquisitionPriority - left.acquisitionPriority ||
    left.hitRect.inlineSize * left.hitRect.blockSize -
      right.hitRect.inlineSize * right.hitRect.blockSize ||
    compareCodeUnits(left.id, right.id)
  );
}

export function groupForPanel(
  projection: WorkspaceProjection,
  panelId: string,
): WorkspaceGroupView | undefined {
  return Object.values(projection.groups).find((group) => group.panelIds.includes(panelId));
}

export function nodeForGroup(projection: WorkspaceProjection, groupId: string): string | undefined {
  return Object.values(projection.nodes).find(
    (node) => node.kind === "group" && node.groupId === groupId,
  )?.id;
}

export function panelsForGroup(
  projection: WorkspaceProjection,
  group: WorkspaceGroupView,
): readonly WorkspacePanelView[] {
  return group.panelIds
    .map((panelId) => projection.panels[panelId])
    .filter((panel): panel is WorkspacePanelView => panel !== undefined);
}

export function logicalEdgeLabel(
  edge: WorkspaceLogicalEdge,
  direction: WorkspaceDirection,
): WorkspacePhysicalEdge {
  if (edge === "block-start") return "above";
  if (edge === "block-end") return "below";
  if (edge === "inline-start") return direction === "rtl" ? "right" : "left";
  return direction === "rtl" ? "left" : "right";
}

export function splitLabel(
  panel: WorkspacePanelView,
  group: WorkspaceGroupView,
  edge: WorkspaceLogicalEdge,
  direction: WorkspaceDirection,
  format: PanelDropLabels["splitPanel"] = DEFAULT_PANEL_DROP_LABELS.splitPanel,
): string {
  return format({
    title: panel.title,
    edge: logicalEdgeLabel(edge, direction),
    group: groupLabel(group),
  });
}

export function groupLabel(group: WorkspaceGroupView): string {
  return group.label?.trim() || "panel group";
}

function clampRatio(value: number): number {
  return Number.isFinite(value) ? Math.min(0.9, Math.max(0.1, value)) : 0.5;
}

function edgeDistance(candidate: PanelDropCandidate, point: LogicalPoint): number {
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

function freezeDropRequest(request: WorkspacePanelDropRequest): WorkspacePanelDropRequest {
  const copyPanel = (panel: WorkspacePanelView) => Object.freeze({ ...panel });
  const copyGroup = (group: WorkspaceGroupView) =>
    Object.freeze({ ...group, panelIds: Object.freeze([...group.panelIds]) });
  return Object.freeze({
    ...request,
    panel: copyPanel(request.panel),
    sourceGroup: copyGroup(request.sourceGroup),
    sourcePanels: Object.freeze(request.sourcePanels.map(copyPanel)),
    targetGroup: copyGroup(request.targetGroup),
    targetPanels: Object.freeze(request.targetPanels.map(copyPanel)),
    target: Object.freeze({ ...request.target }),
  });
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function expandedAxis(
  start: number,
  size: number,
  boundsStart: number,
  boundsSize: number,
  minimumSize: number,
): { readonly start: number; readonly size: number } {
  const safeBoundsSize = Math.max(0, boundsSize);
  const safeMinimum = Number.isFinite(minimumSize) ? Math.max(0, Math.round(minimumSize)) : 96;
  const targetSize = Math.min(safeBoundsSize, Math.max(Math.max(0, size), safeMinimum));
  const centeredStart = Math.round(start + size / 2 - targetSize / 2);
  const maximumStart = boundsStart + safeBoundsSize - targetSize;
  return {
    start: Math.min(maximumStart, Math.max(boundsStart, centeredStart)),
    size: targetSize,
  };
}

function expandAxis(
  start: number,
  size: number,
  boundsStart: number,
  boundsSize: number,
  minimumSize: number,
): Pick<LogicalRect, "inlineStart" | "inlineSize"> {
  const expanded = expandedAxis(start, size, boundsStart, boundsSize, minimumSize);
  return { inlineStart: expanded.start, inlineSize: expanded.size };
}

function expandBlockAxis(
  start: number,
  size: number,
  boundsStart: number,
  boundsSize: number,
  minimumSize: number,
): Pick<LogicalRect, "blockStart" | "blockSize"> {
  const expanded = expandedAxis(start, size, boundsStart, boundsSize, minimumSize);
  return { blockStart: expanded.start, blockSize: expanded.size };
}

const DEFAULT_PANEL_DROP_LABELS: PanelDropLabels = Object.freeze({
  movedPanelTo: ({ title, group }: { readonly title: string; readonly group: string }) =>
    `Move ${title} to ${group}`,
  splitPanel: ({
    title,
    edge,
    group,
  }: {
    readonly title: string;
    readonly edge: WorkspacePhysicalEdge;
    readonly group: string;
  }) => `Split ${title} ${edge} of ${group}`,
});
