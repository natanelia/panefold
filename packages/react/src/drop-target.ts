import { containsPoint, type LogicalPoint, type LogicalRect } from "@panefold/geometry";

import type { WorkspaceDropBehavior, WorkspaceLogicalEdge } from "./types";

/** Pointer acquisition is independent of the rectangle produced by the commit planner. */
export interface EditorDropArea {
  readonly groupRect: LogicalRect;
  readonly contentRect: LogicalRect;
  readonly headerRects: readonly LogicalRect[];
  readonly inlineEdgeRatio: number;
  readonly blockEdgeRatio: number;
  readonly preferredSplitDirection: "right" | "down";
}

export interface MeasuredDropGroup {
  readonly contentRect: LogicalRect;
  readonly headerRects: readonly LogicalRect[];
}

export function createEditorDropArea(
  groupRect: LogicalRect,
  measured: MeasuredDropGroup | undefined,
  edgeRatio = 0.1,
  draggingGroup = false,
  behavior?: WorkspaceDropBehavior,
): EditorDropArea {
  const ratio = Number.isFinite(edgeRatio) ? Math.min(1 / 3, Math.max(0, edgeRatio)) : 0.1;
  return {
    groupRect,
    contentRect: measured?.contentRect ?? groupRect,
    headerRects: measured?.headerRects ?? [],
    inlineEdgeRatio:
      draggingGroup && behavior?.preferredSplitDirection === "down" ? Math.min(0.1, ratio) : ratio,
    blockEdgeRatio:
      draggingGroup && behavior?.preferredSplitDirection !== "down" ? Math.min(0.1, ratio) : ratio,
    preferredSplitDirection: behavior?.preferredSplitDirection ?? "right",
  };
}

/**
 * VS Code's default side-by-side policy: a large merge center, a narrow edge
 * band, then thirds (not nearest-edge distance) to resolve the corners. A tab
 * strip is a merge target, never an accidental split above/alongside the tabs.
 * See docs/drag-drop-previews.md for the upstream implementation and scope.
 */
export function hitTestEditorDropArea(
  area: EditorDropArea,
  point: LogicalPoint,
  enableSplitting = true,
): "center" | WorkspaceLogicalEdge | undefined {
  if (area.headerRects.some((rect) => containsPoint(rect, point))) return "center";
  if (!containsPoint(area.groupRect, point)) return undefined;
  if (!enableSplitting) return "center";
  const rect = area.contentRect;
  // Borders remain part of the edge target, including the exact browser boundary.
  // Only measured tab chrome (handled above) selects a center outside the content.
  const x = Math.min(rect.inlineSize, Math.max(0, point.inline - rect.inlineStart));
  const y = Math.min(rect.blockSize, Math.max(0, point.block - rect.blockStart));
  const edgeX = rect.inlineSize * area.inlineEdgeRatio;
  const edgeY = rect.blockSize * area.blockEdgeRatio;
  if (x > edgeX && x < rect.inlineSize - edgeX && y > edgeY && y < rect.blockSize - edgeY) {
    return "center";
  }
  if (area.preferredSplitDirection === "down") {
    if (y < rect.blockSize / 3) return "block-start";
    if (y > (rect.blockSize * 2) / 3) return "block-end";
    return x < rect.inlineSize / 2 ? "inline-start" : "inline-end";
  }
  if (x < rect.inlineSize / 3) return "inline-start";
  if (x > (rect.inlineSize * 2) / 3) return "inline-end";
  return y < rect.blockSize / 2 ? "block-start" : "block-end";
}
