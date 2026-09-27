import type { LogicalRect, ResolvedLayout } from "@panefold/geometry";

import type { MeasuredDropGroup } from "./drop-target";
import type { WorkspaceDirection } from "./types";

interface PhysicalRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface DropGeometry {
  readonly groups: Readonly<Record<string, MeasuredDropGroup>>;
  readonly isCurrent: () => boolean;
  readonly watch: (onChange: () => void) => void;
  readonly dispose: () => void;
}

/** Target chrome is cached for pointer frames and checked again at release. */
export function captureDropGeometry(
  root: HTMLElement | null,
  rootRect: PhysicalRect,
  bounds: LogicalRect,
  layout: ResolvedLayout,
  direction: WorkspaceDirection,
): DropGeometry {
  const measure = () => measureDropGroups(root, rootRect, bounds, layout, direction);
  const groups = measure();
  const key = JSON.stringify(groups);
  const isCurrent = () => JSON.stringify(measure()) === key;
  let observer: ResizeObserver | undefined;
  return {
    groups,
    isCurrent,
    watch(onChange) {
      observer?.disconnect();
      const Observer = root?.ownerDocument.defaultView?.ResizeObserver;
      if (root === null || Observer === undefined) return;
      observer = new Observer(() => {
        if (!isCurrent()) onChange();
      });
      for (const element of root.querySelectorAll<HTMLElement>(
        ".pf-group, .pf-panel-slot, .pf-tab-strip",
      )) {
        if (element.closest(".pf-workspace") === root) observer.observe(element);
      }
    },
    dispose() {
      observer?.disconnect();
      observer = undefined;
    },
  };
}

/** Measure once at drag start; pointer frames do not read layout. */
export function measureDropGroups(
  root: HTMLElement | null,
  rootRect: PhysicalRect,
  bounds: LogicalRect,
  layout: ResolvedLayout,
  direction: WorkspaceDirection,
): Readonly<Record<string, MeasuredDropGroup>> {
  const groups: Record<string, MeasuredDropGroup> = {};
  if (root === null || rootRect.width <= 0 || rootRect.height <= 0) return groups;
  const strips = Array.from(root.querySelectorAll<HTMLElement>("[role=tablist]"));
  for (const group of root.querySelectorAll<HTMLElement>("[data-workspace-group]")) {
    if (group.closest(".pf-workspace") !== root) continue;
    const groupId = group.dataset.workspaceGroup;
    const groupRect = groupId === undefined ? undefined : layout.groupRects[groupId];
    const slot = group.querySelector<HTMLElement>("[data-workspace-panel-slot]");
    if (groupId === undefined || groupRect === undefined || slot === null) continue;
    const measured = slot.getBoundingClientRect();
    // The headless/hidden case deliberately retains solved group geometry.
    if (measured.width <= 0 || measured.height <= 0) continue;
    const contentRect = intersectRect(
      toLogicalRect(measured, rootRect, bounds, direction),
      groupRect,
    );
    if (contentRect.inlineSize <= 0 || contentRect.blockSize <= 0) continue;
    const labelId = group.getAttribute("aria-labelledby");
    const headerRects = strips.flatMap((strip) => {
      if (labelId === null || strip.getAttribute("aria-labelledby") !== labelId) return [];
      // Include strip controls and the compact floating-header portal, too.
      const header = strip.closest<HTMLElement>(".pf-tab-strip") ?? strip;
      const rect = header.getBoundingClientRect();
      return rect.width <= 0 || rect.height <= 0
        ? []
        : [toLogicalRect(rect, rootRect, bounds, direction)];
    });
    groups[groupId] = { contentRect, headerRects };
  }
  return groups;
}

export function setDropPreviewRect(element: HTMLElement | null, rect: PhysicalRect | undefined) {
  if (element === null) return;
  if (rect === undefined) {
    element.hidden = true;
    delete element.dataset.moving;
    return;
  }
  // Do not animate from the previous drag's stale rectangle on first display.
  element.dataset.moving = String(!element.hidden);
  element.style.setProperty("--pf-drop-x", `${rect.left}px`);
  element.style.setProperty("--pf-drop-y", `${rect.top}px`);
  element.style.setProperty("--pf-drop-width", `${rect.width}px`);
  element.style.setProperty("--pf-drop-height", `${rect.height}px`);
  element.hidden = false;
}

function toLogicalRect(
  rect: PhysicalRect,
  root: PhysicalRect,
  bounds: LogicalRect,
  direction: WorkspaceDirection,
): LogicalRect {
  const scaleX = bounds.inlineSize / root.width;
  const scaleY = bounds.blockSize / root.height;
  return {
    inlineStart:
      bounds.inlineStart +
      (direction === "rtl"
        ? root.left + root.width - rect.left - rect.width
        : rect.left - root.left) *
        scaleX,
    blockStart: bounds.blockStart + (rect.top - root.top) * scaleY,
    inlineSize: rect.width * scaleX,
    blockSize: rect.height * scaleY,
  };
}

function intersectRect(rect: LogicalRect, bounds: LogicalRect): LogicalRect {
  const inlineStart = Math.max(rect.inlineStart, bounds.inlineStart);
  const blockStart = Math.max(rect.blockStart, bounds.blockStart);
  return {
    inlineStart,
    blockStart,
    inlineSize: Math.max(
      0,
      Math.min(rect.inlineStart + rect.inlineSize, bounds.inlineStart + bounds.inlineSize) -
        inlineStart,
    ),
    blockSize: Math.max(
      0,
      Math.min(rect.blockStart + rect.blockSize, bounds.blockStart + bounds.blockSize) - blockStart,
    ),
  };
}
