import type { Rect } from "@panefold/model";

import { PRODUCTIVE_MOTION_TOKENS } from "./tokens";
import type { MotionPlan } from "./types";

export type FlipStrategy = "transform-content" | "translate-and-clip" | "shell-crossfade" | "none";

export interface FlipPlanInput {
  readonly targetId: string;
  readonly scopeId: string;
  readonly before: Rect;
  readonly after: Rect;
  readonly strategy: FlipStrategy;
  readonly durationMs?: number;
}

export function createFlipPlan(input: FlipPlanInput): MotionPlan {
  validateRect(input.before, "before");
  validateRect(input.after, "after");
  const durationMs = input.durationMs ?? PRODUCTIVE_MOTION_TOKENS.duration.structural;
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new RangeError("FLIP duration must be finite and non-negative");
  }
  if (input.strategy === "none") {
    return Object.freeze({
      targetId: input.targetId,
      scopeId: input.scopeId,
      channel: "layout",
      keyframes: {},
      durationMs: 0,
      interruption: "replace",
    });
  }
  if (input.strategy === "shell-crossfade") {
    return Object.freeze({
      targetId: input.targetId,
      scopeId: input.scopeId,
      channel: "layout",
      keyframes: { opacity: [0.72, 1] },
      durationMs,
      easing: "ease-out",
      interruption: "replace",
    });
  }

  const translateX = input.before.x - input.after.x;
  const translateY = input.before.y - input.after.y;
  const scaleX = input.after.width === 0 ? 1 : input.before.width / input.after.width;
  const scaleY = input.after.height === 0 ? 1 : input.before.height / input.after.height;
  const invert =
    input.strategy === "translate-and-clip"
      ? `translate(${format(translateX)}px, ${format(translateY)}px)`
      : `translate(${format(translateX)}px, ${format(translateY)}px) scale(${format(scaleX)}, ${format(scaleY)})`;

  return Object.freeze({
    targetId: input.targetId,
    scopeId: input.scopeId,
    channel: "layout",
    keyframes: Object.freeze({ transform: [invert, "none"] }),
    durationMs,
    easing: [0.2, 0, 0, 1],
    interruption: "replace",
  });
}

function validateRect(rect: Rect, label: string): void {
  if (
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width < 0 ||
    rect.height < 0
  ) {
    throw new RangeError(`${label} FLIP rectangle must be finite and non-negative`);
  }
}

function format(value: number): string {
  return String(Math.round(value * 1_000) / 1_000);
}
