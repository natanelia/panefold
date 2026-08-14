import type { LogicalRect, ResolvedLayout } from "@panefold/geometry";
import type { Rect } from "@panefold/model";

import type { WorkspaceDirection, WorkspaceProjection } from "./types";

interface FloatingNodeMotionContext {
  readonly surfaceId: string;
  readonly rootNodeId: string;
}

export interface WorkspaceNodeMotionSnapshot {
  readonly layout: ResolvedLayout;
  readonly floatingContextByNodeId: ReadonlyMap<string, FloatingNodeMotionContext>;
}

export interface WorkspaceNodeMotionTransition {
  readonly before: Rect;
  readonly after: Rect;
}

/**
 * Captures geometry together with each node's DOM motion coordinate space.
 * Floating descendants move with their frame, so their structural motion must
 * be measured relative to that frame rather than the merged workspace layout.
 */
export function createWorkspaceNodeMotionSnapshot(
  projection: WorkspaceProjection,
  layout: ResolvedLayout,
): WorkspaceNodeMotionSnapshot {
  const floatingContextByNodeId = new Map<string, FloatingNodeMotionContext>();
  for (const surface of projection.floatingSurfaces ?? []) {
    const context = { surfaceId: surface.id, rootNodeId: surface.rootNodeId };
    const pending = [surface.rootNodeId];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const nodeId = pending.pop();
      if (nodeId === undefined || visited.has(nodeId)) continue;
      visited.add(nodeId);
      floatingContextByNodeId.set(nodeId, context);
      const node = projection.nodes[nodeId];
      if (node?.kind === "split") pending.push(...node.childIds);
    }
  }
  return { layout, floatingContextByNodeId };
}

export function resolveWorkspaceNodeMotionTransition(
  nodeId: string,
  previous: WorkspaceNodeMotionSnapshot,
  current: WorkspaceNodeMotionSnapshot,
  workspaceBounds: LogicalRect,
  direction: WorkspaceDirection,
): WorkspaceNodeMotionTransition | undefined {
  const beforeRect = previous.layout.nodeRects[nodeId];
  const afterRect = current.layout.nodeRects[nodeId];
  if (beforeRect === undefined || afterRect === undefined) return undefined;

  const previousContext = previous.floatingContextByNodeId.get(nodeId);
  const currentContext = current.floatingContextByNodeId.get(nodeId);
  let before: Rect;
  let after: Rect;

  if (
    previousContext !== undefined &&
    currentContext !== undefined &&
    previousContext.surfaceId === currentContext.surfaceId
  ) {
    const beforeRoot = previous.layout.nodeRects[previousContext.rootNodeId];
    const afterRoot = current.layout.nodeRects[currentContext.rootNodeId];
    if (beforeRoot !== undefined && afterRoot !== undefined) {
      before = localPhysicalRect(beforeRect, beforeRoot, direction);
      after = localPhysicalRect(afterRect, afterRoot, direction);
    } else {
      before = logicalRectToPhysical(beforeRect, workspaceBounds, direction);
      after = logicalRectToPhysical(afterRect, workspaceBounds, direction);
    }
  } else {
    before = logicalRectToPhysical(beforeRect, workspaceBounds, direction);
    after = logicalRectToPhysical(afterRect, workspaceBounds, direction);
  }

  return sameRect(before, after) ? undefined : { before, after };
}

function localPhysicalRect(
  rect: LogicalRect,
  surfaceRoot: LogicalRect,
  direction: WorkspaceDirection,
): Rect {
  const localRect = {
    inlineStart: rect.inlineStart - surfaceRoot.inlineStart,
    blockStart: rect.blockStart - surfaceRoot.blockStart,
    inlineSize: rect.inlineSize,
    blockSize: rect.blockSize,
  };
  return logicalRectToPhysical(
    localRect,
    {
      inlineStart: 0,
      blockStart: 0,
      inlineSize: surfaceRoot.inlineSize,
      blockSize: surfaceRoot.blockSize,
    },
    direction,
  );
}

function logicalRectToPhysical(
  rect: LogicalRect,
  bounds: LogicalRect,
  direction: WorkspaceDirection,
): Rect {
  return {
    x:
      direction === "rtl"
        ? bounds.inlineStart +
          bounds.inlineSize -
          (rect.inlineStart - bounds.inlineStart) -
          rect.inlineSize
        : rect.inlineStart,
    y: rect.blockStart,
    width: rect.inlineSize,
    height: rect.blockSize,
  };
}

function sameRect(left: Rect, right: Rect): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}
