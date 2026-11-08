// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { measureClientScale, measureContentBox } from "../src/client-coordinates";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function elementWithSizes(
  layoutWidth: number,
  layoutHeight: number,
  clientWidth: number,
  clientHeight: number,
) {
  const element = document.createElement("div");
  Object.defineProperties(element, {
    offsetWidth: { value: layoutWidth },
    offsetHeight: { value: layoutHeight },
  });
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
    new DOMRect(50, 30, clientWidth, clientHeight),
  );
  return element;
}

describe("pointer coordinate scales", () => {
  it.each([0.75, 1, 1.5])(
    "converts screen movement back into layout pixels at scale %s",
    (scale) => {
      const element = elementWithSizes(800, 600, 800 * scale, 600 * scale);
      const measured = measureClientScale(element);
      expect((48 * scale) / measured.x).toBe(48);
      expect((-36 * scale) / measured.y).toBe(-36);
    },
  );

  it("keeps horizontal and vertical scaling independent", () => {
    const measured = measureClientScale(elementWithSizes(800, 600, 1200, 450));
    expect(60 / measured.x).toBe(40);
    expect(30 / measured.y).toBe(40);
  });

  it("does not mistake offset-size rounding for a CSS transform", () => {
    expect(measureClientScale(elementWithSizes(333, 101, 333.25, 100.75))).toEqual({ x: 1, y: 1 });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "uses unscaled coordinates for an unmeasurable size (%s)",
    (size) => {
      expect(measureClientScale(elementWithSizes(0, 600, 800, size))).toEqual({ x: 1, y: 1 });
      expect(measureClientScale(elementWithSizes(size, size, 800, 600))).toEqual({ x: 1, y: 1 });
    },
  );

  it("supports detached or unavailable gesture containers", () => {
    expect(measureClientScale(null)).toEqual({ x: 1, y: 1 });
    expect(measureClientScale(document.createElement("div"))).toEqual({ x: 1, y: 1 });
  });
});

describe("initial workspace size", () => {
  it("uses the unscaled content box, excluding padding and borders", () => {
    const element = elementWithSizes(844, 624, 1266, 936);
    element.style.cssText = "border: 2px solid; padding: 10px 20px";
    Object.defineProperties(element, {
      clientWidth: { value: 840 },
      clientHeight: { value: 620 },
    });
    document.body.append(element);
    expect(measureContentBox(element)).toEqual({ width: 800, height: 600 });
  });

  it("keeps a hidden content box at zero even when it has padding", () => {
    const element = document.createElement("div");
    element.style.padding = "20px";
    document.body.append(element);
    expect(measureContentBox(element)).toEqual({ width: 0, height: 0 });
  });
});
