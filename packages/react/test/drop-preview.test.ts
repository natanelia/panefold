// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedLayout } from "@panefold/geometry";
import { captureDropGeometry, measureDropGroups, setDropPreviewRect } from "../src/drop-preview";

const bounds = { inlineStart: 10, blockStart: 20, inlineSize: 800, blockSize: 600 };
const rootRect = { left: 100, top: 200, width: 1600, height: 1200 };
const layout: ResolvedLayout = {
  rootNodeId: "root",
  nodeRects: { root: bounds },
  groupRects: { target: bounds },
  splitters: [],
  collapsedNodeIds: [],
  diagnostics: [],
};
function setRect(element: Element, left: number, top: number, width: number, height: number) {
  return vi
    .spyOn(element, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(left, top, width, height));
}
function fixture(portaled = false) {
  const root = document.createElement("div");
  root.className = "pf-workspace";
  const group = document.createElement("section");
  group.className = "pf-group";
  group.dataset.workspaceGroup = "target";
  group.setAttribute("aria-labelledby", "target-label");
  const slot = document.createElement("div");
  slot.className = "pf-panel-slot";
  slot.dataset.workspacePanelSlot = "target";
  const header = document.createElement("div");
  header.className = "pf-tab-strip";
  const tabs = document.createElement("div");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-labelledby", "target-label");
  header.append(tabs);
  group.append(slot);
  root.append(group);
  (portaled ? root : group).append(header);
  document.body.append(root);
  setRect(slot, 100, 280, 800, 1120);
  setRect(header, 100, 200, 800, 80);
  return { root, group, slot, header };
}
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("drop geometry capture", () => {
  it.each([false, true])(
    "measures normal/portaled headers with scale and offset (%s)",
    (portaled) => {
      const { root } = fixture(portaled);
      expect(measureDropGroups(root, rootRect, bounds, layout, "ltr").target).toEqual({
        contentRect: { inlineStart: 10, blockStart: 60, inlineSize: 400, blockSize: 560 },
        headerRects: [{ inlineStart: 10, blockStart: 20, inlineSize: 400, blockSize: 40 }],
      });
      expect(
        measureDropGroups(root, rootRect, bounds, layout, "rtl").target?.contentRect.inlineStart,
      ).toBe(410);
    },
  );

  it("measures the content beside a vertical tab strip", () => {
    const { root, slot, header } = fixture();
    setRect(slot, 220, 200, 680, 1200);
    setRect(header, 100, 200, 120, 1200);
    const target = measureDropGroups(root, rootRect, bounds, layout, "ltr").target;
    expect(target?.contentRect.inlineStart).toBe(70);
    expect(target?.contentRect.blockStart).toBe(20);
    expect(target?.headerRects[0]?.inlineSize).toBe(60);
  });

  it("falls back to solved geometry when slots are hidden or not measured", () => {
    const { root, slot } = fixture();
    setRect(slot, 0, 0, 0, 0);
    expect(measureDropGroups(root, rootRect, bounds, layout, "ltr")).toEqual({});
    expect(measureDropGroups(null, rootRect, bounds, layout, "ltr")).toEqual({});
  });

  it("excludes nested workspaces", () => {
    const { root } = fixture();
    const nested = fixture();
    root.append(nested.root);
    nested.slot.getBoundingClientRect = vi.fn(() => {
      throw new Error("nested layout read");
    });
    expect(measureDropGroups(root, rootRect, bounds, layout, "ltr").target).toBeDefined();
  });

  it("invalidates target content geometry and disposes its observer", () => {
    let callback: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class Observer {
      constructor(listener: ResizeObserverCallback) {
        callback = listener;
      }
      observe = observe;
      disconnect = disconnect;
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", Observer);
    const { root, slot } = fixture();
    const geometry = captureDropGeometry(root, rootRect, bounds, layout, "ltr");
    const changed = vi.fn();
    geometry.watch(changed);
    expect(observe).toHaveBeenCalledWith(slot);
    expect(geometry.isCurrent()).toBe(true);
    setRect(slot, 100, 320, 800, 1080);
    expect(geometry.isCurrent()).toBe(false);
    callback?.([], {} as ResizeObserver);
    expect(changed).toHaveBeenCalledOnce();
    geometry.dispose();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

describe("drop overlay presentation", () => {
  it("shows the first rectangle immediately, then enables movement, and clears on exit", () => {
    const preview = document.createElement("div");
    preview.hidden = true;
    setDropPreviewRect(preview, rootRect);
    expect(preview.hidden).toBe(false);
    expect(preview.dataset.moving).toBe("false");
    expect(preview.style.getPropertyValue("--pf-drop-width")).toBe("1600px");
    setDropPreviewRect(preview, { ...rootRect, width: 800 });
    expect(preview.dataset.moving).toBe("true");
    setDropPreviewRect(preview, undefined);
    expect(preview.hidden).toBe(true);
    expect(preview.dataset.moving).toBeUndefined();
    setDropPreviewRect(preview, rootRect);
    expect(preview.dataset.moving).toBe("false");
    setDropPreviewRect(null, rootRect);
  });
});
