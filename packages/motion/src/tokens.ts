import type { MotionPlan, MotionProfile } from "./types";

export interface SpringToken {
  readonly visualDurationMs: number;
  readonly bounce: number;
}

export interface WorkspaceMotionTokens {
  readonly duration: {
    readonly instant: number;
    readonly micro: number;
    readonly fast: number;
    readonly structural: number;
    readonly surface: number;
    readonly attention: number;
  };
  readonly spring: {
    readonly settle: SpringToken;
    readonly snap: SpringToken;
    readonly indicator: SpringToken;
  };
  readonly distance: {
    readonly entry: number;
    readonly lift: number;
    readonly snapMagnetMaximum: number;
  };
}

export const PRODUCTIVE_MOTION_TOKENS: WorkspaceMotionTokens = Object.freeze({
  duration: Object.freeze({
    instant: 0,
    micro: 90,
    fast: 140,
    structural: 200,
    surface: 260,
    attention: 600,
  }),
  spring: Object.freeze({
    settle: Object.freeze({ visualDurationMs: 210, bounce: 0 }),
    snap: Object.freeze({ visualDurationMs: 170, bounce: 0 }),
    indicator: Object.freeze({ visualDurationMs: 150, bounce: 0.02 }),
  }),
  distance: Object.freeze({
    entry: 8,
    lift: 2,
    snapMagnetMaximum: 10,
  }),
});

export function adaptPlanToProfile(plan: MotionPlan, profile: MotionProfile): MotionPlan {
  if (plan.essential) {
    return plan;
  }
  if (profile === "off") {
    return { ...plan, durationMs: 0 };
  }
  if (profile === "reduced") {
    const opacity = plan.keyframes.opacity;
    return {
      ...plan,
      keyframes: opacity === undefined ? {} : { opacity },
      durationMs: Math.min(plan.durationMs, PRODUCTIVE_MOTION_TOKENS.duration.micro),
      easing: "linear",
    };
  }
  return plan;
}
