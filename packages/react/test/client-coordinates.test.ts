// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  measureClientScale,
  measureContentBox,
  revealInScrollport,
} from "../src/client-coordinates";

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

function scrollFixture(
  orientation: "horizontal" | "vertical",
  start: number,
  size: number,
  scaleX = 1,
  scaleY = 1,
  direction: "ltr" | "rtl" = "ltr",
) {
  const scrollport = elementWithSizes(204, 44, 204 * scaleX, 44 * scaleY);
  scrollport.dir = direction;
  scrollport.style.scrollBehavior = "smooth";
  const horizontal = orientation === "horizontal";
  const initial = direction === "rtl" && horizontal ? -400 : 400;
  scrollport.scrollLeft = horizontal ? initial : 17;
  scrollport.scrollTop = horizontal ? 23 : initial;
  const scroll = vi.fn((options: ScrollToOptions) => {
    scrollport.scrollLeft += options.left ?? 0;
    scrollport.scrollTop += options.top ?? 0;
  });
  Object.defineProperties(scrollport, {
    clientLeft: { value: 2 },
    clientTop: { value: 2 },
    clientWidth: { configurable: true, value: 200 },
    clientHeight: { configurable: true, value: 40 },
    scrollWidth: { configurable: true, value: 2000 },
    scrollHeight: { configurable: true, value: 2000 },
    scrollBy: { value: scroll },
  });
  const element = document.createElement("button");
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => {
    const offset = start + initial - (horizontal ? scrollport.scrollLeft : scrollport.scrollTop);
    return horizontal
      ? new DOMRect(50 + (2 + offset) * scaleX, 30 + 2 * scaleY, size * scaleX, 20 * scaleY)
      : new DOMRect(50 + 2 * scaleX, 30 + (2 + offset) * scaleY, 80 * scaleX, size * scaleY);
  });
  scrollport.append(element);
  document.body.append(scrollport);
  return { element, scrollport, scroll, initial };
}

describe("selected element visibility", () => {
  it.each([0.75, 1, 1.5])("reveals only the bordered scrollport at scale %s", (scale) => {
    const { element, scrollport, scroll, initial } = scrollFixture(
      "horizontal",
      180,
      80,
      scale,
      1.5,
    );
    const ancestor = document.createElement("div");
    document.body.append(ancestor);
    ancestor.append(scrollport);
    ancestor.scrollLeft = 31;
    ancestor.scrollTop = 47;
    expect(revealInScrollport(element, scrollport, "horizontal")).toBe(true);
    expect(scrollport.scrollLeft).toBe(initial + 60);
    expect(scrollport.scrollTop).toBe(23);
    expect(scroll).toHaveBeenCalledWith({ left: 60, behavior: "instant" });
    expect(ancestor.scrollLeft).toBe(31);
    expect(ancestor.scrollTop).toBe(47);
    expect(revealInScrollport(element, scrollport, "horizontal")).toBe(true);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("reveals a vertical strip using its independent scale", () => {
    const { element, scrollport, scroll, initial } = scrollFixture("vertical", 30, 20, 1.5, 0.75);
    expect(revealInScrollport(element, scrollport, "vertical")).toBe(true);
    expect(scrollport.scrollTop).toBe(initial + 10);
    expect(scrollport.scrollLeft).toBe(17);
    expect(scroll).toHaveBeenCalledWith({ top: 10, behavior: "instant" });
  });

  it("uses negative RTL offsets without reversing physical deltas", () => {
    const { element, scrollport, scroll, initial } = scrollFixture(
      "horizontal",
      -80,
      80,
      1.5,
      1,
      "rtl",
    );
    expect(revealInScrollport(element, scrollport, "horizontal")).toBe(true);
    expect(scrollport.scrollLeft).toBe(initial - 80);
    expect(scroll).toHaveBeenCalledWith({ left: -80, behavior: "instant" });
    revealInScrollport(element, scrollport, "horizontal");
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it.each([
    { start: 40, size: 80, delta: 0 },
    { start: -30, size: 80, delta: -30 },
    { start: -20, size: 240, delta: 0 },
    { start: -260, size: 240, delta: -220 },
    { start: 240, size: 260, delta: 240 },
  ])("uses nearest alignment for a tab at $start with size $size", ({ start, size, delta }) => {
    const { element, scrollport, scroll, initial } = scrollFixture("horizontal", start, size);
    expect(revealInScrollport(element, scrollport, "horizontal")).toBe(true);
    expect(scrollport.scrollLeft).toBe(initial + delta);
    revealInScrollport(element, scrollport, "horizontal");
    expect(scroll).toHaveBeenCalledTimes(delta === 0 ? 0 : 1);
  });

  it("waits for a measurable strip and selected element", () => {
    const { element, scrollport, scroll } = scrollFixture("horizontal", 180, 80);
    Object.defineProperty(scrollport, "clientWidth", { configurable: true, value: 0 });
    expect(revealInScrollport(element, scrollport, "horizontal")).toBe(false);
    Object.defineProperty(scrollport, "clientWidth", { configurable: true, value: 200 });
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect());
    expect(revealInScrollport(element, scrollport, "horizontal")).toBe(false);
    expect(scroll).not.toHaveBeenCalled();
  });

  it("does not scroll a strip without overflow", () => {
    const { element, scrollport, scroll } = scrollFixture("horizontal", 180, 80);
    Object.defineProperty(scrollport, "scrollWidth", { configurable: true, value: 200 });
    expect(revealInScrollport(element, scrollport, "horizontal")).toBe(true);
    expect(scroll).not.toHaveBeenCalled();
  });
});
