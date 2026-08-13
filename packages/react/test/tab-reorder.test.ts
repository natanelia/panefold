import { describe, expect, it } from "vitest";

import {
  createTabReorderIndex,
  hitTestTabReorder,
  resolveTabReorderCandidate,
  translateTabReorderIndex,
  type MeasuredTab,
} from "../src/tab-reorder";

const labels = {
  moveBefore: ({ title, anchor }: { title: string; anchor: string }) =>
    `Move ${title} before ${anchor}`,
  moveAfter: ({ title, anchor }: { title: string; anchor: string }) =>
    `Move ${title} after ${anchor}`,
  movedBefore: ({ title, anchor }: { title: string; anchor: string }) =>
    `Moved ${title} before ${anchor}`,
  movedAfter: ({ title, anchor }: { title: string; anchor: string }) =>
    `Moved ${title} after ${anchor}`,
  keptPosition: ({ title }: { title: string }) => `${title} stayed`,
};

describe("tab reorder geometry", () => {
  it("uses unequal physical tab widths for deterministic LTR insertion slots", () => {
    const index = horizontalIndex("ltr");
    expect(hitTestTabReorder(index, { x: 20, y: 17 })?.placement).toEqual({
      beforePanelId: "first",
    });
    expect(hitTestTabReorder(index, { x: 170, y: 17 })?.changed).toBe(false);
    expect(hitTestTabReorder(index, { x: 360, y: 17 })?.placement).toEqual({});
  });

  it("maps the same logical slots from the right edge in RTL", () => {
    const index = createIndex({
      direction: "rtl",
      orientation: "horizontal",
      tabs: [
        measured("first", "First", 300, 0, 100, 34),
        measured("source", "Source", 180, 0, 120, 34),
        measured("last", "Last", 0, 0, 180, 34),
      ],
      strip: { left: 0, top: 0, width: 400, height: 34 },
    });
    expect(hitTestTabReorder(index, { x: 380, y: 17 })?.placement).toEqual({
      beforePanelId: "first",
    });
    expect(hitTestTabReorder(index, { x: 20, y: 17 })?.placement).toEqual({});
  });

  it("uses vertical rail geometry and computes sibling transforms only for the active slot", () => {
    const index = createIndex({
      direction: "rtl",
      orientation: "vertical",
      tabs: [
        measured("first", "First", 0, 0, 64, 30),
        measured("source", "Source", 0, 30, 64, 50),
        measured("last", "Last", 0, 80, 64, 70),
      ],
      strip: { left: 0, top: 0, width: 64, height: 150 },
    });
    expect(index.slots.every((slot) => Object.keys(slot.shifts).length === 0)).toBe(true);
    const raw = hitTestTabReorder(index, { x: 32, y: 140 });
    expect(raw?.placement).toEqual({});
    if (raw === undefined) throw new Error("Expected append slot");
    expect(resolveTabReorderCandidate(index, raw).shifts).toEqual({
      last: { x: 0, y: -50 },
    });
  });

  it("builds a 500-tab index linearly and performs logarithmic slot lookup", () => {
    let commandCount = 0;
    const tabs = Array.from({ length: 500 }, (_unused, index) =>
      measured(`tab-${String(index)}`, `Tab ${String(index)}`, index * 40, 0, 40, 34),
    );
    const sourceTab = tabs[250];
    if (sourceTab === undefined) throw new Error("Expected a source tab");
    const result = createTabReorderIndex({
      panel: sourceTab.panel,
      groupId: "many",
      orderedTabs: tabs,
      stripRect: { left: 0, top: 0, width: 20_000, height: 34 },
      orientation: "horizontal",
      direction: "ltr",
      createCommand: () => {
        commandCount += 1;
        return commandCount;
      },
      labels,
    });
    if (result === undefined) throw new Error("Expected large reorder index");
    expect(result.slots).toHaveLength(500);
    expect(commandCount).toBe(0);
    expect(hitTestTabReorder(result, { x: 19_990, y: 17 })?.placement).toEqual({});
    const selected = hitTestTabReorder(result, { x: 19_990, y: 17 });
    if (selected === undefined) throw new Error("Expected selected reorder slot");
    result.createCommand(result.panel.id, result.groupId, selected.placement);
    expect(commandCount).toBe(1);
  });

  it("translates a cached index after scroll and freshly resolves the same slot", () => {
    const index = horizontalIndex("ltr");
    const beforeSlot = hitTestTabReorder(index, { x: 350, y: 17 });
    if (beforeSlot === undefined) throw new Error("Expected append slot");
    const before = resolveTabReorderCandidate(index, beforeSlot);
    const translated = translateTabReorderIndex(index, { x: -40, y: 0 });
    const afterSlot = hitTestTabReorder(translated, { x: 350, y: 17 });
    if (afterSlot === undefined) throw new Error("Expected translated append slot");
    const after = resolveTabReorderCandidate(translated, afterSlot, before);

    expect(after.id).toBe(before.id);
    expect(after).not.toBe(before);
    expect(after.indicatorRect.left).toBe(before.indicatorRect.left - 40);
    expect(after.shifts).toBe(before.shifts);
    expect(translated.orderedTabs).toBe(index.orderedTabs);
    expect(translated.slots).toBe(index.slots);
  });
});

function horizontalIndex(direction: "ltr" | "rtl") {
  return createIndex({
    direction,
    orientation: "horizontal",
    tabs: [
      measured("first", "First", 0, 0, 80, 34),
      measured("source", "Source", 80, 0, 160, 34),
      measured("last", "Last", 240, 0, 160, 34),
    ],
    strip: { left: 0, top: 0, width: 400, height: 34 },
  });
}

function createIndex(options: {
  direction: "ltr" | "rtl";
  orientation: "horizontal" | "vertical";
  tabs: readonly MeasuredTab[];
  strip: { left: number; top: number; width: number; height: number };
}) {
  const source = options.tabs.find((tab) => tab.panel.id === "source");
  if (source === undefined) throw new Error("Missing source tab");
  const result = createTabReorderIndex({
    panel: source.panel,
    groupId: "group",
    orderedTabs: options.tabs,
    stripRect: options.strip,
    orientation: options.orientation,
    direction: options.direction,
    createCommand: (panelId, groupId, placement) => ({ panelId, groupId, placement }),
    labels,
  });
  if (result === undefined) throw new Error("Expected reorder index");
  return result;
}

function measured(
  id: string,
  title: string,
  left: number,
  top: number,
  width: number,
  height: number,
): MeasuredTab {
  return {
    panel: { id, title, type: "fixture" },
    rect: { left, top, width, height },
  };
}
