import type { LogicalRect, ResolvedLayout } from "@panefold/geometry";

import type { WorkspaceProjection, WorkspaceResizePreviewMode } from "./types";

export type ResolvedResizePreviewMode = Exclude<WorkspaceResizePreviewMode, "auto">;

export interface SplitResizePreview {
  readonly splitId: string;
  readonly splitterId: string;
  readonly mode: ResolvedResizePreviewMode;
}

/** Resolve once at gesture start; hidden or unrelated panels cannot defer a resize. */
export function resolveSplitResizePreviewMode(
  mode: WorkspaceResizePreviewMode,
  projection: WorkspaceProjection,
  splitId: string,
  visibleGroupIds: ReadonlySet<string>,
): ResolvedResizePreviewMode {
  if (mode !== "auto") return mode;
  const pending = [splitId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || visited.has(id)) continue;
    visited.add(id);
    const node = projection.nodes[id];
    if (node?.kind === "split") {
      pending.push(...node.childIds);
    } else if (node?.kind === "group" && visibleGroupIds.has(node.groupId)) {
      const group = projection.groups[node.groupId];
      const panel = group === undefined ? undefined : projection.panels[group.selectedPanelId];
      if (panel?.resizeDelivery === "deferred") return "separator";
    }
  }
  return "live";
}

/** The marker is disposable DOM state. It never moves or resizes panel hosts. */
export function showSplitResizePreview(
  element: HTMLDivElement | null,
  layout: ResolvedLayout,
  preview: SplitResizePreview,
  bounds: LogicalRect,
): void {
  if (element === null) return;
  const splitter = layout.splitters.find((item) => item.id === preview.splitterId);
  if (splitter === undefined) {
    element.hidden = true;
    return;
  }
  const rect = splitter.rect;
  element.style.insetInlineStart = `${rect.inlineStart - bounds.inlineStart}px`;
  element.style.insetBlockStart = `${rect.blockStart - bounds.blockStart}px`;
  element.style.inlineSize = `${rect.inlineSize}px`;
  element.style.blockSize = `${rect.blockSize}px`;
  element.dataset.splitId = preview.splitId;
  element.dataset.axis = splitter.axis;
  element.hidden = false;
}
