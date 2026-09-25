import type { ResolvedLayout } from "@panefold/geometry";

import {
  createPanelDropRequest,
  planPanelDrop,
  surfaceLayoutBoundsForNode,
  type PanelDropCandidate,
} from "./panel-drop";
import type { MeasuredTab, PhysicalTabRect, TabStripOrientation } from "./tab-reorder";
import type {
  WorkspaceDirection,
  WorkspacePanelDropPlan,
  WorkspacePanelDropPlanContext,
  WorkspacePanelDropRequest,
  WorkspaceProjection,
} from "./types";

export interface TabInsertionSlot<TCommand> {
  readonly candidate: PanelDropCandidate<TCommand> | undefined;
  readonly indicatorRect: PhysicalTabRect;
}

export interface TabInsertionStrip<TCommand> {
  readonly groupId: string;
  readonly stripRect: PhysicalTabRect;
  readonly tabs: readonly MeasuredTab[];
  readonly orientation: TabStripOrientation;
  readonly direction: WorkspaceDirection;
  readonly slots: readonly TabInsertionSlot<TCommand>[];
  readonly isCurrent: () => boolean;
}

/** All geometry and commands are captured once. Pointer frames only select a retained slot. */
export function captureTabInsertionStrips<TCommand>(
  root: HTMLElement | null,
  candidates: readonly PanelDropCandidate<TCommand>[],
  projection: WorkspaceProjection,
  layout: ResolvedLayout,
  direction: WorkspaceDirection,
  splitterSize: number,
  planner:
    | ((
        request: WorkspacePanelDropRequest,
        context: WorkspacePanelDropPlanContext,
      ) => WorkspacePanelDropPlan<TCommand> | undefined)
    | undefined,
): readonly TabInsertionStrip<TCommand>[] {
  if (root === null || planner === undefined) return [];
  const groups = new Map(
    Array.from(root.querySelectorAll<HTMLElement>("[data-workspace-group]")).map((element) => [
      element.dataset.workspaceGroup,
      element,
    ]),
  );
  const tabLists = Array.from(root.querySelectorAll<HTMLElement>("[role=tablist]"));
  return candidates.flatMap((base) => {
    if (base.request.target.kind !== "center") return [];
    const group = groups.get(base.request.targetGroup.id);
    const label = group?.getAttribute("aria-labelledby");
    if (label === undefined || label === null) return [];
    const strip = tabLists.find(
      (element) =>
        element.getAttribute("aria-labelledby") === label &&
        element.closest(".pf-workspace") === root,
    );
    if (strip === undefined) return [];
    const elements = new Map(
      Array.from(strip.querySelectorAll<HTMLElement>("[data-workspace-panel-tab]")).map(
        (element) => [element.dataset.workspacePanelTab, element],
      ),
    );
    const tabs = base.request.targetPanels.flatMap((panel) => {
      const element = elements.get(panel.id);
      return element === undefined ? [] : [{ panel, rect: rectOf(element) }];
    });
    const stripRect = rectOf(strip);
    if (
      tabs.length === 0 ||
      tabs.length !== base.request.targetPanels.length ||
      stripRect.width <= 0 ||
      stripRect.height <= 0
    )
      return [];
    const orientation: TabStripOrientation =
      strip.closest<HTMLElement>("[data-tab-orientation]")?.dataset.tabOrientation === "vertical"
        ? "vertical"
        : "horizontal";
    const slots = tabs.map((tab, index) => createSlot(index, { beforePanelId: tab.panel.id }));
    const last = tabs[tabs.length - 1];
    if (last === undefined) return [];
    slots.push(createSlot(tabs.length, { afterPanelId: last.panel.id }));
    return [
      {
        groupId: base.request.targetGroup.id,
        stripRect,
        tabs,
        orientation,
        direction,
        slots,
        isCurrent: () =>
          strip.isConnected &&
          equalRect(stripRect, rectOf(strip)) &&
          tabs.every((tab) => {
            const element = elements.get(tab.panel.id);
            return (
              element !== undefined && element.isConnected && equalRect(tab.rect, rectOf(element))
            );
          }),
      },
    ];

    function createSlot(
      index: number,
      anchor: { beforePanelId?: string; afterPanelId?: string },
    ): TabInsertionSlot<TCommand> {
      const request = createPanelDropRequest(
        projection,
        base.request.panel.id,
        base.request.targetGroup.id,
        base.request.targetNodeId,
        { kind: "center", ratio: 1, ...anchor },
      );
      const rect = layout.groupRects[base.request.targetGroup.id];
      const plan =
        request === undefined || rect === undefined
          ? undefined
          : planPanelDrop(
              planner,
              request,
              rect,
              layout,
              splitterSize,
              surfaceLayoutBoundsForNode(projection, layout, base.request.targetNodeId),
            );
      return {
        candidate:
          request === undefined || plan === undefined
            ? undefined
            : {
                ...base,
                id: `tab-insert:${base.request.targetNodeId}:${index}`,
                request,
                plan,
                previewRect: plan.previewRect,
              },
        indicatorRect: insertionIndicator(tabs, index, stripRect, orientation, direction),
      };
    }
  });
}

/** Midpoints choose before/after. Unused header space appends, not an edge split. */
export function hitTestTabInsertion<TCommand>(
  strips: readonly TabInsertionStrip<TCommand>[],
  groupId: string,
  point: { readonly x: number; readonly y: number },
): TabInsertionSlot<TCommand> | undefined {
  const strip = strips.find(
    (candidate) => candidate.groupId === groupId && contains(candidate.stripRect, point),
  );
  if (strip === undefined) return undefined;
  const coordinate =
    strip.orientation === "vertical" ? point.y : strip.direction === "rtl" ? -point.x : point.x;
  const index = strip.tabs.findIndex(({ rect }) => {
    const midpoint =
      strip.orientation === "vertical" ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
    return (
      coordinate <
      (strip.orientation === "horizontal" && strip.direction === "rtl" ? -midpoint : midpoint)
    );
  });
  return strip.slots[index < 0 ? strip.tabs.length : index];
}

export function insertionIndicator(
  tabs: readonly MeasuredTab[],
  index: number,
  strip: PhysicalTabRect,
  orientation: TabStripOrientation,
  direction: WorkspaceDirection,
): PhysicalTabRect {
  const next = tabs[index];
  const previous = tabs[index - 1];
  const rect = (next ?? previous)?.rect ?? strip;
  if (orientation === "vertical") {
    const top = next === undefined ? rect.top + rect.height : rect.top;
    return {
      left: strip.left,
      top: clamp(top - 1, strip.top, strip.top + strip.height - 2),
      width: strip.width,
      height: 2,
    };
  }
  const left =
    next === undefined
      ? direction === "rtl"
        ? rect.left
        : rect.left + rect.width
      : direction === "rtl"
        ? rect.left + rect.width
        : rect.left;
  return {
    left: clamp(left - 1, strip.left, strip.left + strip.width - 2),
    top: strip.top,
    width: 2,
    height: strip.height,
  };
}

function rectOf(element: HTMLElement): PhysicalTabRect {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
}
function equalRect(a: PhysicalTabRect, b: PhysicalTabRect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}
function contains(
  rect: PhysicalTabRect,
  point: { readonly x: number; readonly y: number },
): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.left + rect.width &&
    point.y >= rect.top &&
    point.y <= rect.top + rect.height
  );
}
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
