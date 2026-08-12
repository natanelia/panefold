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
    sample(element: Element, properties: readonly string[]) {
      if (!isAnimatableElement(element)) return {};
      const view = element.ownerDocument.defaultView;
      if (view === null) return {};
      const computed = view.getComputedStyle(element);
      const sampled: Record<string, string> = {};
      for (const property of properties) {
        sampled[property] = computed.getPropertyValue(property);
      }
      return Object.freeze(sampled);
    },
    animate(element: Element, plan: MotionPlan): MotionHandle {
      if (!isAnimatableElement(element)) {
        return {
          finished: Promise.resolve(),
          cancel() {},
          finish() {},
          skip() {},
          dispose() {},
        };
      }

      const controls = animateElement(element, plan.keyframes, {
        duration: Math.max(0, plan.durationMs) / 1_000,
        ease: normalizeDomEasing(plan.easing),
      });

      return {
        finished: controls.finished.then(() => undefined),
        cancel: () => controls.cancel(),
        finish: () => controls.complete(),
        skip: () => controls.complete(),
        dispose: () => controls.cancel(),
      };
    },
  };
}

function normalizeDomEasing(easing: MotionPlan["easing"]): string | readonly number[] {
  if (easing === undefined) return [0, 0, 0.58, 1];
  if (typeof easing !== "string") return easing;
  const presets: Readonly<Record<string, readonly number[]>> = {
    ease: [0.25, 0.1, 0.25, 1],
    "ease-in": [0.42, 0, 1, 1],
    "ease-out": [0, 0, 0.58, 1],
    "ease-in-out": [0.42, 0, 0.58, 1],
  };
  const preset = presets[easing];
  if (preset !== undefined) return preset;
  const match =
    /^cubic-bezier\(\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*\)$/u.exec(
      easing,
    );
  if (match === null) return easing;
  return match.slice(1).map(Number);
}

function isAnimatableElement(element: Element): element is HTMLElement | SVGElement {
  const view = element.ownerDocument?.defaultView;
  if (view === null || view === undefined) return false;
  return element instanceof view.HTMLElement || element instanceof view.SVGElement;
}
