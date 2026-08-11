import { animate } from "motion";

import type { MotionDriver, MotionHandle, MotionPlan } from "./types";

interface AnimationControls {
  readonly finished: Promise<unknown>;
  cancel(): void;
  complete(): void;
}

type ElementAnimator = (
  element: HTMLElement | SVGElement,
  keyframes: MotionPlan["keyframes"],
  options: { readonly duration: number; readonly ease: MotionPlan["easing"] },
) => AnimationControls;

// Motion exposes a large overload set for elements, selectors, objects, and
// sequences. This adapter deliberately narrows it to the one capability owned
// by the workspace motion port.
const animateElement = animate as unknown as ElementAnimator;

export function createMotionDomDriver(): MotionDriver {
  return {
    animate(element: Element, plan: MotionPlan): MotionHandle {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
        return {
          finished: Promise.resolve(),
          cancel() {},
          finish() {},
        };
      }

      const controls = animateElement(element, plan.keyframes, {
        duration: Math.max(0, plan.durationMs) / 1_000,
        ease: plan.easing ?? "ease-out",
      });

      return {
        finished: controls.finished.then(() => undefined),
        cancel: () => controls.cancel(),
        finish: () => controls.complete(),
      };
    },
  };
}
