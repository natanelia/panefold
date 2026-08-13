import type {
  DropTarget,
  LogicalEdge,
  LogicalPoint,
  LogicalRect,
  ResolvedLayout,
} from "./types.js";

export function containsPoint(rect: LogicalRect, point: LogicalPoint): boolean {
  return (
    point.inline >= rect.inlineStart &&
    point.inline < rect.inlineStart + rect.inlineSize &&
    point.block >= rect.blockStart &&
    point.block < rect.blockStart + rect.blockSize
  );
}

/** Returns the smallest resolved node under the point, with stable ID ties. */
export function hitTestNodes(layout: ResolvedLayout, point: LogicalPoint): string | undefined {
  let winnerId: string | undefined;
  let winnerArea = Number.POSITIVE_INFINITY;

  // A drag frame only needs the best match. Sorting every containing node
  // allocated two intermediate arrays and performed O(m log m) work, where m
  // is the number of overlapping ancestors. A single scan keeps the exact
  // area/ID ordering while doing O(n) work with no per-candidate allocations.
  for (const nodeId in layout.nodeRects) {
    if (!Object.hasOwn(layout.nodeRects, nodeId)) continue;
    const rect = layout.nodeRects[nodeId];
    if (
      rect === undefined ||
      rect.inlineSize <= 0 ||
      rect.blockSize <= 0 ||
      !containsPoint(rect, point)
    ) {
      continue;
    }
    const area = rect.inlineSize * rect.blockSize;
    if (
      area < winnerArea ||
      (area === winnerArea && (winnerId === undefined || nodeId < winnerId))
    ) {
      winnerId = nodeId;
      winnerArea = area;
    }
  }
  return winnerId;
}

function edgeRect(rect: LogicalRect, edge: LogicalEdge, depth: number): LogicalRect {
  if (edge === "inline-start") return { ...rect, inlineSize: depth };
  if (edge === "inline-end") {
    return {
      ...rect,
      inlineStart: rect.inlineStart + rect.inlineSize - depth,
      inlineSize: depth,
    };
  }
  if (edge === "block-start") return { ...rect, blockSize: depth };
  return {
    ...rect,
    blockStart: rect.blockStart + rect.blockSize - depth,
    blockSize: depth,
  };
}

/**
 * Derives non-overlapping logical edge and center targets from the exact leaf
 * rectangle. Commit code can pass the chosen target back to the same solver.
 */
export function createDropTargets(
  nodeId: string,
  rect: LogicalRect,
  edgeRatio = 0.25,
): readonly DropTarget[] {
  const ratio = Number.isFinite(edgeRatio) ? Math.min(0.45, Math.max(0, edgeRatio)) : 0.25;
  const inlineDepth = Math.min(
    Math.floor(Math.max(0, rect.inlineSize) / 2),
    Math.round(Math.max(0, rect.inlineSize) * ratio),
  );
  const blockDepth = Math.min(
    Math.floor(Math.max(0, rect.blockSize) / 2),
    Math.round(Math.max(0, rect.blockSize) * ratio),
  );
  const center: LogicalRect = {
    inlineStart: rect.inlineStart + inlineDepth,
    blockStart: rect.blockStart + blockDepth,
    inlineSize: Math.max(0, rect.inlineSize - inlineDepth * 2),
    blockSize: Math.max(0, rect.blockSize - blockDepth * 2),
  };

  return [
    { kind: "inside", nodeId, rect: center },
    {
      kind: "split",
      nodeId,
      edge: "inline-start",
      rect: {
        ...edgeRect(rect, "inline-start", inlineDepth),
        blockStart: center.blockStart,
        blockSize: center.blockSize,
      },
    },
    {
      kind: "split",
      nodeId,
      edge: "inline-end",
      rect: {
        ...edgeRect(rect, "inline-end", inlineDepth),
        blockStart: center.blockStart,
        blockSize: center.blockSize,
      },
    },
    { kind: "split", nodeId, edge: "block-start", rect: edgeRect(rect, "block-start", blockDepth) },
    { kind: "split", nodeId, edge: "block-end", rect: edgeRect(rect, "block-end", blockDepth) },
  ];
}
