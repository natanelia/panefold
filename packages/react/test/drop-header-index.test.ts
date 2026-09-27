// @vitest-environment jsdom
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedLayout } from "@panefold/geometry";
import { measureDropGroups } from "../src/drop-preview";
import { measureDropGroups as original } from "./reference-drop-preview";
const bounds = { inlineStart: 10, blockStart: 20, inlineSize: 800, blockSize: 600 };
const rootRect = { left: 100, top: 200, width: 1600, height: 1200 };
function fixture(labels: readonly (string | null)[], portaled: boolean) {
  const root = document.createElement("div");
  root.className = "pf-workspace";
  document.body.append(root);
  const groupRects: Record<string, typeof bounds> = {};
  const groups: HTMLElement[] = [],
    strips: HTMLElement[] = [];
  for (const [i, label] of labels.entries()) {
    const group = document.createElement("section");
    group.dataset.workspaceGroup = `g:${i}`;
    if (label !== null) group.setAttribute("aria-labelledby", label);
    const slot = document.createElement("div");
    slot.dataset.workspacePanelSlot = "";
    const header = document.createElement("div");
    header.className = "pf-tab-strip";
    const strip = document.createElement("div");
    strip.setAttribute("role", "tablist");
    if (label !== null) strip.setAttribute("aria-labelledby", label);
    header.append(strip);
    group.append(slot);
    root.append(group);
    (portaled ? root : group).append(header);
    slot.getBoundingClientRect = () => new DOMRect(100, 280, 800, 1120);
    header.getBoundingClientRect = () => new DOMRect(100, 200, 800, 80);
    groupRects[`g:${i}`] = bounds;
    groups.push(group);
    strips.push(strip);
  }
  const layout: ResolvedLayout = {
    rootNodeId: "root",
    nodeRects: {},
    groupRects,
    splitters: [],
    collapsedNodeIds: [],
    diagnostics: [],
  };
  return { root, layout, groups, strips };
}
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
describe("per-measurement drop header index", () => {
  it("retains both threshold paths, duplicate labels, empty labels, null and portals", () => {
    for (const size of [0, 1, 7, 8, 9, 50])
      for (const portaled of [false, true]) {
        const labels = Array.from(
          { length: size },
          (_, i) => [null, "", "same", "same", "__proto__", "中文🙂", "a b"][i % 7] ?? null,
        );
        const { root, layout } = fixture(labels, portaled);
        for (const direction of ["ltr", "rtl"] as const)
          expect(measureDropGroups(root, rootRect, bounds, layout, direction)).toEqual(
            original(root, rootRect, bounds, layout, direction),
          );
        root.remove();
      }
  });
  it("matches the reference for 500 seeded DOM arrangements", () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.string({ maxLength: 12 }), { nil: null }), { maxLength: 30 }),
        fc.boolean(),
        (labels, portaled) => {
          const { root, layout, strips } = fixture(labels, portaled);
          // An unmatched strip and duplicate associations must keep document order.
          if (strips[0]) strips[0].setAttribute("aria-labelledby", "unmatched");
          for (const direction of ["ltr", "rtl"] as const)
            expect(measureDropGroups(root, rootRect, bounds, layout, direction)).toEqual(
              original(root, rootRect, bounds, layout, direction),
            );
          root.remove();
        },
      ),
      { seed: 20260928, numRuns: 500 },
    );
  });
  it("does not retain stale label associations between measurements", () => {
    const { root, layout, groups, strips } = fixture(
      Array.from({ length: 12 }, (_, i) => `label:${i}`),
      true,
    );
    measureDropGroups(root, rootRect, bounds, layout, "ltr");
    groups[0]?.setAttribute("aria-labelledby", "changed");
    strips[1]?.setAttribute("aria-labelledby", "changed");
    expect(measureDropGroups(root, rootRect, bounds, layout, "ltr")).toEqual(
      original(root, rootRect, bounds, layout, "ltr"),
    );
  });
  it("reads strip labels at most twice instead of once per group", () => {
    const { root, layout, strips } = fixture(
      Array.from({ length: 50 }, (_, i) => `label:${i}`),
      true,
    );
    const spies = strips.map((strip) => vi.spyOn(strip, "getAttribute"));
    const actual = measureDropGroups(root, rootRect, bounds, layout, "ltr");
    expect(
      spies.reduce(
        (n, spy) => n + spy.mock.calls.filter(([key]) => key === "aria-labelledby").length,
        0,
      ),
    ).toBe(100);
    expect(actual).toEqual(original(root, rootRect, bounds, layout, "ltr"));
  });
  it("does not build an index for hidden groups", () => {
    const { root, layout, groups, strips } = fixture(
      Array.from({ length: 12 }, (_, i) => `label:${i}`),
      true,
    );
    for (const group of groups) {
      const slot = group.querySelector<HTMLElement>("[data-workspace-panel-slot]");
      if (slot) slot.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    }
    const spies = strips.map((strip) => vi.spyOn(strip, "getAttribute"));
    expect(measureDropGroups(root, rootRect, bounds, layout, "ltr")).toEqual({});
    expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });
});
