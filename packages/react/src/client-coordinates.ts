export interface ClientScale {
  readonly x: number;
  readonly y: number;
}

/**
 * Capture the screen-to-layout relationship once at gesture start. Pointer
 * coordinates include positive axis-aligned CSS transforms and zoom; layout
 * sizes and semantic floating bounds do not. Pointer frames reuse this value.
 */
export function measureClientScale(element: HTMLElement | null): ClientScale {
  if (element === null) return { x: 1, y: 1 };
  const rect = element.getBoundingClientRect();
  return {
    x: clientScale(rect.width, element.offsetWidth),
    y: clientScale(rect.height, element.offsetHeight),
  };
}

/** Match ResizeObserver's content box before its first notification, without screen scaling. */
export function measureContentBox(element: HTMLElement) {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return {
    width: Math.max(
      0,
      element.clientWidth - cssPixels(style?.paddingLeft) - cssPixels(style?.paddingRight),
    ),
    height: Math.max(
      0,
      element.clientHeight - cssPixels(style?.paddingTop) - cssPixels(style?.paddingBottom),
    ),
  };
}

/** Reveal within this scrollport only. False means layout is not measurable yet. */
export function revealInScrollport(
  element: HTMLElement,
  scrollport: HTMLElement,
  orientation: "horizontal" | "vertical",
): boolean {
  if (scrollport.clientWidth <= 0 || scrollport.clientHeight <= 0) return false;
  const portRect = scrollport.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  if (portRect.width <= 0 || portRect.height <= 0 || rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  const horizontal = orientation === "horizontal";
  const viewportSize = horizontal ? scrollport.clientWidth : scrollport.clientHeight;
  if ((horizontal ? scrollport.scrollWidth : scrollport.scrollHeight) <= viewportSize) return true;
  const scale = measureClientScale(scrollport)[horizontal ? "x" : "y"];
  const start =
    (horizontal ? portRect.left : portRect.top) +
    (horizontal ? scrollport.clientLeft : scrollport.clientTop) * scale;
  const end = start + viewportSize * scale;
  const elementStart = horizontal ? rect.left : rect.top;
  const elementEnd = horizontal ? rect.right : rect.bottom;
  const spansViewport = elementStart <= start && elementEnd >= end;
  const oversized = elementEnd - elementStart > end - start;
  let delta = 0;
  if (!spansViewport) {
    if (elementStart < start) delta = oversized ? elementEnd - end : elementStart - start;
    else if (elementEnd > end) delta = oversized ? elementStart - start : elementEnd - end;
  }
  if (delta !== 0) {
    // Physical deltas also handle the negative scrollLeft used by RTL strips.
    // Instant scrolling avoids leaving an animation after selection changes.
    scrollport.scrollBy(
      horizontal
        ? { left: delta / scale, behavior: "instant" }
        : { top: delta / scale, behavior: "instant" },
    );
  }
  return true;
}

function clientScale(clientSize: number, layoutSize: number): number {
  if (
    !Number.isFinite(clientSize) ||
    clientSize <= 0 ||
    !Number.isFinite(layoutSize) ||
    layoutSize <= 0
  ) {
    return 1;
  }
  // offset sizes are rounded; a subpixel border box is not necessarily scaled.
  return Math.abs(clientSize - layoutSize) < 1 ? 1 : clientSize / layoutSize;
}

function cssPixels(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}
