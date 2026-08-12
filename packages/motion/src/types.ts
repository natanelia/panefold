export type MotionChannel =
  "layout" | "gesture" | "presence" | "clip" | "emphasis" | "scroll" | "surface";

export type MotionProfile = "off" | "reduced" | "productive" | "expressive";

/** Interruption modes implemented by the experimental coordinator. */
export type InterruptionPolicy = "retarget" | "replace" | "finish" | "queue" | "ignore";

export type MotionSalience = "direct-input" | "spatial-continuity" | "decoration";

export type MotionKeyframe = string | number;

export type MotionKeyframes = Readonly<Record<string, MotionKeyframe | readonly MotionKeyframe[]>>;

export interface MotionPlan {
  readonly targetId: string;
  readonly channel: MotionChannel;
  readonly scopeId: string;
  readonly keyframes: MotionKeyframes;
  readonly durationMs: number;
  readonly easing?: string | readonly number[];
  readonly interruption: InterruptionPolicy;
  readonly essential?: boolean;
  /** Used only by the optional load-adaptive planner, never persisted. */
  readonly salience?: MotionSalience;
}

export interface MotionHandle {
  readonly finished: Promise<void>;
  cancel(): void;
  finish(): void;
  /** Drivers may provide a more efficient immediate-final-state operation. */
  skip?(): void;
  /** Optional driver-owned cleanup after any terminal outcome. */
  dispose?(): void;
}

export type MotionLeaseStatus =
  "queued" | "running" | "finished" | "cancelled" | "skipped" | "disposed" | "failed";

/** Exactly-once coordinator lease returned for every admitted motion. */
export interface MotionLease extends MotionHandle {
  readonly status: MotionLeaseStatus;
  skip(): void;
  dispose(): void;
}

export interface MotionDriver {
  animate(element: Element, plan: MotionPlan): MotionHandle;
  /** Samples currently rendered properties before an interruptible retarget. */
  sample?(element: Element, properties: readonly string[]): MotionKeyframes;
}
