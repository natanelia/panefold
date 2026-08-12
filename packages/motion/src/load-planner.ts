import { PRODUCTIVE_MOTION_TOKENS } from "./tokens";
import type { MotionPlan } from "./types";

export type MotionLoadPressure = "normal" | "constrained" | "critical";
export type MotionLoadDecision = "preserved" | "decoration-skipped" | "spatial-shortened";

export interface MotionLoadSample {
  /** Display-frame budget, for example 16.67ms at 60Hz or 8.33ms at 120Hz. */
  readonly frameBudgetMs: number;
  /** Recent measured frame work owned by the application and workspace. */
  readonly observedFrameMs: number;
  readonly changedEntityCount: number;
  readonly heavyContentCount?: number;
}

export interface MotionLoadPolicy {
  readonly constrainedFrameRatio?: number;
  readonly criticalFrameRatio?: number;
  readonly constrainedEntityCount?: number;
  readonly criticalEntityCount?: number;
  readonly constrainedHeavyContentCount?: number;
}

export interface LoadAdaptiveMotionResult {
  readonly pressure: MotionLoadPressure;
  readonly decision: MotionLoadDecision;
  readonly plan: MotionPlan;
}

const DEFAULT_POLICY = Object.freeze({
  constrainedFrameRatio: 0.75,
  criticalFrameRatio: 1,
  constrainedEntityCount: 24,
  criticalEntityCount: 96,
  constrainedHeavyContentCount: 2,
});

/**
 * Deterministic, observational load adaptation. Decoration is skipped at the
 * first pressure tier; spatial continuity is only shortened at the critical
 * tier. Direct input and essential plans are returned byte-for-byte unchanged.
 */
export function adaptPlanToLoad(
  plan: MotionPlan,
  sample: MotionLoadSample,
  policy: MotionLoadPolicy = {},
): LoadAdaptiveMotionResult {
  validateSample(sample);
  const resolved = resolvePolicy(policy);
  const pressure = classifyMotionLoad(sample, resolved);
  const salience = plan.salience ?? "spatial-continuity";

  if (plan.essential || salience === "direct-input" || pressure === "normal") {
    return Object.freeze({ pressure, decision: "preserved", plan });
  }
  if (salience === "decoration") {
    return Object.freeze({
      pressure,
      decision: "decoration-skipped",
      plan: Object.freeze({ ...plan, durationMs: 0 }),
    });
  }
  if (pressure === "critical") {
    return Object.freeze({
      pressure,
      decision: "spatial-shortened",
      plan: Object.freeze({
        ...plan,
        durationMs: Math.min(plan.durationMs, PRODUCTIVE_MOTION_TOKENS.duration.fast),
      }),
    });
  }
  return Object.freeze({ pressure, decision: "preserved", plan });
}

export function planMotionForLoad(
  plans: readonly MotionPlan[],
  sample: MotionLoadSample,
  policy: MotionLoadPolicy = {},
): readonly LoadAdaptiveMotionResult[] {
  return Object.freeze(plans.map((plan) => adaptPlanToLoad(plan, sample, policy)));
}

function classifyMotionLoad(
  sample: MotionLoadSample,
  policy: Required<MotionLoadPolicy>,
): MotionLoadPressure {
  const frameRatio = sample.observedFrameMs / sample.frameBudgetMs;
  if (
    frameRatio >= policy.criticalFrameRatio ||
    sample.changedEntityCount >= policy.criticalEntityCount
  ) {
    return "critical";
  }
  if (
    frameRatio >= policy.constrainedFrameRatio ||
    sample.changedEntityCount >= policy.constrainedEntityCount ||
    (sample.heavyContentCount ?? 0) >= policy.constrainedHeavyContentCount
  ) {
    return "constrained";
  }
  return "normal";
}

function resolvePolicy(policy: MotionLoadPolicy): Required<MotionLoadPolicy> {
  const resolved = { ...DEFAULT_POLICY, ...policy };
  const values = Object.values(resolved);
  if (!values.every((value) => Number.isFinite(value) && value >= 0)) {
    throw new RangeError("Motion load policy values must be finite and non-negative");
  }
  if (resolved.criticalFrameRatio < resolved.constrainedFrameRatio) {
    throw new RangeError("Critical frame ratio cannot be below constrained frame ratio");
  }
  if (resolved.criticalEntityCount < resolved.constrainedEntityCount) {
    throw new RangeError("Critical entity count cannot be below constrained entity count");
  }
  return resolved;
}

function validateSample(sample: MotionLoadSample): void {
  if (!Number.isFinite(sample.frameBudgetMs) || sample.frameBudgetMs <= 0) {
    throw new RangeError("frameBudgetMs must be finite and greater than zero");
  }
  for (const [name, value] of Object.entries({
    observedFrameMs: sample.observedFrameMs,
    changedEntityCount: sample.changedEntityCount,
    heavyContentCount: sample.heavyContentCount ?? 0,
  })) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${name} must be finite and non-negative`);
    }
  }
}
