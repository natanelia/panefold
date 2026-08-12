import type { Rect, SurfaceCapabilities, SurfaceKind } from "@panefold/model";

import type { ExternalSurfaceKind, SurfaceCapabilityProfile } from "./types";

const CAPABILITY_KEYS = [
  "nestedLayout",
  "floating",
  "popout",
  "alwaysOnTop",
  "freePositioning",
  "crossDocument",
  "multiScreenPlacement",
] as const satisfies readonly (keyof SurfaceCapabilities)[];

export function intersectSurfaceCapabilities(
  ...profiles: readonly SurfaceCapabilities[]
): SurfaceCapabilities {
  const result = Object.create(null) as Record<keyof SurfaceCapabilities, boolean>;
  for (const key of CAPABILITY_KEYS) {
    result[key] = profiles.length > 0 && profiles.every((profile) => profile[key]);
  }
  return Object.freeze(result);
}

export function supportsExternalKind(
  kind: ExternalSurfaceKind,
  capabilities: SurfaceCapabilities,
): boolean {
  return kind === "browser-window"
    ? capabilities.popout && capabilities.crossDocument
    : capabilities.alwaysOnTop && capabilities.crossDocument;
}

export function chooseSurfaceFallback(
  requested: ExternalSurfaceKind,
  available: readonly SurfaceCapabilityProfile[],
): SurfaceKind | undefined {
  const requestedProfile = available.find(
    (profile) =>
      profile.kind === requested && supportsExternalKind(requested, profile.capabilities),
  );
  if (requestedProfile !== undefined) return requestedProfile.kind;

  const floating = available.find(
    (profile) => profile.kind === "floating" && profile.capabilities.floating,
  );
  if (floating !== undefined) return "floating";

  return available.find((profile) => profile.kind === "main")?.kind;
}

export interface ViewportBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Physical safe-area insets because surface bounds use physical x/y coordinates. */
  readonly safeInsetLeft?: number;
  readonly safeInsetRight?: number;
  readonly safeInsetTop?: number;
  readonly safeInsetBottom?: number;
}

export function clampSurfaceRect(rect: Rect, viewport: ViewportBounds, minimumVisible = 48): Rect {
  const insetLeft = viewport.safeInsetLeft ?? 0;
  const insetRight = viewport.safeInsetRight ?? 0;
  const insetTop = viewport.safeInsetTop ?? 0;
  const insetBottom = viewport.safeInsetBottom ?? 0;
  const values = [
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    viewport.x,
    viewport.y,
    viewport.width,
    viewport.height,
    minimumVisible,
    insetLeft,
    insetRight,
    insetTop,
    insetBottom,
  ];
  if (
    !values.every(Number.isFinite) ||
    [
      rect.width,
      rect.height,
      viewport.width,
      viewport.height,
      minimumVisible,
      insetLeft,
      insetRight,
      insetTop,
      insetBottom,
    ].some((value) => value < 0)
  ) {
    throw new RangeError("Surface and viewport geometry must be finite and non-negative");
  }

  const usableX = viewport.x + insetLeft;
  const usableY = viewport.y + insetTop;
  const usableWidth = Math.max(0, viewport.width - insetLeft - insetRight);
  const usableHeight = Math.max(0, viewport.height - insetTop - insetBottom);
  const visibleInline = Math.min(Math.max(0, minimumVisible), rect.width, usableWidth);
  const visibleBlock = Math.min(Math.max(0, minimumVisible), rect.height, usableHeight);
  const minX = usableX - rect.width + visibleInline;
  const maxX = usableX + usableWidth - visibleInline;
  const minY = usableY - rect.height + visibleBlock;
  const maxY = usableY + usableHeight - visibleBlock;

  return Object.freeze({
    x: clamp(rect.x, minX, maxX),
    y: clamp(rect.y, minY, maxY),
    width: rect.width,
    height: rect.height,
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (minimum > maximum) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}
