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
