// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPanelDropCandidates } from "../src/panel-drop";
import { captureTabInsertionStrips, hitTestTabInsertion } from "../src/tab-insertion";
import type { WorkspacePanelDropRequest, WorkspaceProjection } from "../src/types";
import type { ResolvedLayout } from "@panefold/geometry";

const targetRect = { inlineStart: 400, blockStart: 0, inlineSize: 400, blockSize: 400 };
const projection: WorkspaceProjection = {
  revision: "0",
  rootNodeId: "root",
  activePanelId: "a",
  nodes: {
    root: {
      id: "root",
      kind: "split",
      axis: "inline",
      childIds: ["left-node", "right-node"],
      weights: [0.5, 0.5],
    },
    "left-node": { id: "left-node", kind: "group", groupId: "left" },
    "right-node": { id: "right-node", kind: "group", groupId: "right" },
  },
  groups: {
    left: { id: "left", panelIds: ["a"], selectedPanelId: "a" },
    right: { id: "right", panelIds: ["b", "c"], selectedPanelId: "b" },
  },
  panels: {
    a: { id: "a", type: "fixture", title: "Alpha" },
    b: { id: "b", type: "fixture", title: "Beta" },
    c: { id: "c", type: "fixture", title: "Gamma" },
  },
};
const layout: ResolvedLayout = {
  rootNodeId: "root",
  nodeRects: {
    root: { ...targetRect, inlineStart: 0, inlineSize: 800 },
    "right-node": targetRect,
    "left-node": { ...targetRect, inlineStart: 0 },
  },
  groupRects: { left: { ...targetRect, inlineStart: 0 }, right: targetRect },
  splitters: [],
  collapsedNodeIds: [],
  diagnostics: [],
};
const planner = (request: WorkspacePanelDropRequest) => ({
  command: { request },
  previewRect: targetRect,
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function fixture(mode: "ltr" | "rtl" | "vertical", rejectFirst = false) {
  const root = document.createElement("div");
  root.className = "pf-workspace";
  root.innerHTML =
    '<section data-workspace-group="right" aria-labelledby="right-title" data-tab-orientation="' +
    (mode === "vertical" ? "vertical" : "horizontal") +
    '"><div role="tablist" aria-labelledby="right-title"><button data-workspace-panel-tab="b"></button><button data-workspace-panel-tab="c"></button></div></section>';
  document.body.append(root);
  const strip = required(root.querySelector<HTMLElement>('[role="tablist"]'));
  const b = required(root.querySelector<HTMLElement>('[data-workspace-panel-tab="b"]'));
  const c = required(root.querySelector<HTMLElement>('[data-workspace-panel-tab="c"]'));
  const vertical = mode === "vertical";
  vi.spyOn(strip, "getBoundingClientRect").mockReturnValue(
    new DOMRect(400, 0, vertical ? 80 : 300, vertical ? 300 : 30),
  );
  const br = new DOMRect(mode === "rtl" ? 600 : 400, 0, vertical ? 80 : 100, 30);
  const cr = new DOMRect(
    mode === "rtl" ? 500 : vertical ? 400 : 500,
    vertical ? 30 : 0,
    vertical ? 80 : 100,
    30,
  );
  vi.spyOn(b, "getBoundingClientRect").mockReturnValue(br);
  vi.spyOn(c, "getBoundingClientRect").mockReturnValue(cr);
  const plan = vi.fn((request: WorkspacePanelDropRequest) =>
    rejectFirst && request.target.kind === "center" && request.target.beforePanelId === "b"
      ? undefined
      : planner(request),
  );
  const candidates = createPanelDropCandidates(
    projection,
    layout,
    "a",
    mode === "rtl" ? "rtl" : "ltr",
    0.1,
    0.5,
    6,
    undefined,
    planner,
  );
  const strips = captureTabInsertionStrips(
    root,
    candidates,
    projection,
    layout,
    mode === "rtl" ? "rtl" : "ltr",
    6,
    plan,
  );
  return { strips, plan, b, c, root, candidates };
}

describe("foreign tab insertion", () => {
  it.each(["ltr", "rtl", "vertical"] as const)(
    "retains before/after plans and clipped markers in %s",
    (mode) => {
      const { strips, plan } = fixture(mode);
      expect(plan).toHaveBeenCalledTimes(3);
      const first = hitTestTabInsertion(
        strips,
        "right",
        mode === "vertical"
          ? { x: 440, y: 2 }
          : mode === "rtl"
            ? { x: 698, y: 15 }
            : { x: 402, y: 15 },
      );
      expect(first?.candidate?.request.target).toEqual({
        kind: "center",
        ratio: 1,
        beforePanelId: "b",
      });
      const end = hitTestTabInsertion(
        strips,
        "right",
        mode === "vertical"
          ? { x: 440, y: 250 }
          : mode === "rtl"
            ? { x: 405, y: 15 }
            : { x: 695, y: 15 },
      );
      expect(end?.candidate?.request.target).toEqual({
        kind: "center",
        ratio: 1,
        afterPanelId: "c",
      });
      expect(end?.candidate?.plan.command).toBe(plan.mock.results[2]?.value?.command);
      const indicator = required(first).indicatorRect;
      expect(indicator.left).toBeGreaterThanOrEqual(400);
      expect(indicator.top).toBeGreaterThanOrEqual(0);
      expect(mode === "vertical" ? indicator.height : indicator.width).toBe(2);
      expect(hitTestTabInsertion(strips, "right", { x: 399, y: 15 })).toBeUndefined();
      expect(hitTestTabInsertion(strips, "other", { x: 450, y: 15 })).toBeUndefined();
      expect(plan).toHaveBeenCalledTimes(3); // no replanning while hovering
    },
  );

  it("does not turn an application-rejected insertion into an append", () => {
    const { strips } = fixture("ltr", true);
    const slot = hitTestTabInsertion(strips, "right", { x: 401, y: 15 });
    expect(slot).toBeDefined();
    expect(slot?.candidate).toBeUndefined();
  });

  it("requires an explicit insertion capability and rejects stale tab geometry", () => {
    const { strips, b, root, candidates } = fixture("ltr");
    expect(
      captureTabInsertionStrips(root, candidates, projection, layout, "ltr", 6, undefined),
    ).toEqual([]);
    expect(strips[0]?.isCurrent()).toBe(true);
    vi.mocked(b.getBoundingClientRect).mockReturnValue(new DOMRect(399, 0, 100, 30));
    expect(strips[0]?.isCurrent()).toBe(false);
  });
});

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected fixture value");
  return value;
}
