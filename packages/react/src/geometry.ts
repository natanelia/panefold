import { allocateAxis } from "@panefold/geometry";
import type {
  GeometryDiagnostic,
  LogicalAxis,
  LogicalRect,
  ResolvedLayout,
  ResolvedSplitter,
  SplitLayoutOverride,
} from "@panefold/geometry";

import type { WorkspaceProjection } from "./types";

export interface WorkspaceLayoutRequest {
  readonly projection: WorkspaceProjection;
  readonly rootNodeId: string;
  readonly bounds: LogicalRect;
  readonly splitterSize: number;
  readonly splitOverrides: Readonly<Record<string, SplitLayoutOverride>>;
}

/**
 * Experimental bridge from an application snapshot to deterministic logical
 * geometry. Model-aware applications should delegate to `solveLayout`; the
 * projection solver remains a constraint-free compatibility fallback.
 */
export type WorkspaceLayoutSolver<TSnapshot> = (
  snapshot: TSnapshot,
  request: WorkspaceLayoutRequest,
) => ResolvedLayout;

export interface ProjectionLayoutOptions {
  readonly splitterSize?: number;
  readonly splitOverrides?: Readonly<Record<string, SplitLayoutOverride>>;
}

/** Resolve a renderer projection with the same exact-conservation allocator as the model solver. */
export function solveWorkspaceProjectionLayout(
  projection: WorkspaceProjection,
  bounds: LogicalRect,
  options: ProjectionLayoutOptions = {},
): ResolvedLayout {
  const splitterSize = finiteSize(options.splitterSize ?? 6);
  const splitOverrides = options.splitOverrides ?? {};
  const diagnostics: GeometryDiagnostic[] = [];
  const nodeRects: Record<string, LogicalRect> = {};
  const groupRects: Record<string, LogicalRect> = {};
  const splitters: ResolvedSplitter[] = [];
  const collapsedNodeIds: string[] = [];
  const visited = new Set<string>();

  const visit = (nodeId: string, rect: LogicalRect): void => {
    if (visited.has(nodeId)) {
      diagnostics.push({
        code: "LAYOUT_CYCLE",
        message: `Layout node ${nodeId} was reached more than once.`,
        nodeId,
      });
      return;
    }
    const node = projection.nodes[nodeId];
    if (node === undefined) {
      diagnostics.push({
        code: "MISSING_NODE",
        message: `Layout node ${nodeId} is missing from the renderer projection.`,
        nodeId,
      });
      return;
    }

    visited.add(nodeId);
    nodeRects[nodeId] = rect;
    if (node.kind === "group") {
      groupRects[node.groupId] = rect;
      return;
    }

    const override = splitOverrides[node.id];
    const weights = validWeights(override?.weights, node.childIds.length)
      ? override.weights
      : node.weights;
    if (override?.weights !== undefined && weights !== override.weights) {
      diagnostics.push({
        code: "INVALID_OVERRIDE",
        message: `Speculative weights for ${node.id} were ignored.`,
        nodeId: node.id,
      });
    }
    const collapsed = new Set(override?.collapsedChildIds ?? []);
    const allocation = allocateAxis(
      node.childIds.map((childId, index) => ({
        key: childId,
        weight: positiveWeight(weights[index]),
        collapsed: collapsed.has(childId),
      })),
      node.axis === "inline" ? rect.inlineSize : rect.blockSize,
      splitterSize,
    );
    diagnostics.push(...allocation.diagnostics.map((item) => ({ ...item, nodeId: node.id })));

    const activePositionByIndex = new Map(
      allocation.activeIndices.map((childIndex, activePosition) => [childIndex, activePosition]),
    );
    let cursor = node.axis === "inline" ? rect.inlineStart : rect.blockStart;

    node.childIds.forEach((childId, childIndex) => {
      const activePosition = activePositionByIndex.get(childIndex);
      const childSize = allocation.sizes[childIndex] ?? 0;
      if (activePosition === undefined) {
        nodeRects[childId] = rectAlongAxis(rect, node.axis, cursor, 0);
        collapsedNodeIds.push(childId);
        return;
      }

      const childRect = rectAlongAxis(rect, node.axis, cursor, childSize);
      visit(childId, childRect);
      cursor += childSize;

      if (activePosition < allocation.activeIndices.length - 1) {
        const afterIndex = allocation.activeIndices[activePosition + 1];
        const afterNodeId = afterIndex === undefined ? undefined : node.childIds[afterIndex];
        if (afterNodeId === undefined) return;
        const size = allocation.splitterSizes[activePosition] ?? 0;
        splitters.push({
          id: `${node.id}:splitter:${childId}:${afterNodeId}`,
          splitNodeId: node.id,
          axis: node.axis,
          beforeNodeId: childId,
          afterNodeId,
          rect: rectAlongAxis(rect, node.axis, cursor, size),
        });
        cursor += size;
      }
    });
  };

  const rootBounds = {
    inlineStart: finiteOrigin(bounds.inlineStart),
    blockStart: finiteOrigin(bounds.blockStart),
    inlineSize: finiteSize(bounds.inlineSize),
    blockSize: finiteSize(bounds.blockSize),
  };
  visit(projection.rootNodeId, rootBounds);

  return {
    rootNodeId: projection.rootNodeId,
    nodeRects,
    groupRects,
    splitters,
    collapsedNodeIds,
    diagnostics,
  };
}

function rectAlongAxis(
  parent: LogicalRect,
  axis: LogicalAxis,
  start: number,
  size: number,
): LogicalRect {
  return axis === "inline"
    ? { ...parent, inlineStart: start, inlineSize: size }
    : { ...parent, blockStart: start, blockSize: size };
}

function validWeights(
  weights: readonly number[] | undefined,
  expectedLength: number,
): weights is readonly number[] {
  return (
    weights !== undefined &&
    weights.length === expectedLength &&
    weights.every((weight) => Number.isFinite(weight) && weight > 0)
  );
}

function positiveWeight(weight: number | undefined): number {
  return weight !== undefined && Number.isFinite(weight) && weight > 0 ? weight : 1;
}

function finiteOrigin(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function finiteSize(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}
