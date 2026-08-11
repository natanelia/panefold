export type MotionChannel =
  "layout" | "gesture" | "presence" | "clip" | "emphasis" | "scroll" | "surface";

export type MotionProfile = "off" | "reduced" | "productive" | "expressive";

/** Interruption modes implemented by the experimental coordinator. */
export type InterruptionPolicy = "replace" | "finish" | "ignore";

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
}

export interface MotionHandle {
  readonly finished: Promise<void>;
  cancel(): void;
  finish(): void;
}

export interface MotionDriver {
  animate(element: Element, plan: MotionPlan): MotionHandle;
}
