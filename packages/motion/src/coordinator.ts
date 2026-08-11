import { adaptPlanToProfile } from "./tokens";
import type { MotionDriver, MotionHandle, MotionPlan, MotionProfile } from "./types";

interface RunningMotion {
  readonly plan: MotionPlan;
  readonly handle: MotionHandle;
}

export class MotionCoordinator {
  readonly #driver: MotionDriver;
  readonly #running = new Map<string, RunningMotion>();
  #profile: MotionProfile;

  public constructor(driver: MotionDriver, profile: MotionProfile = "productive") {
    this.#driver = driver;
    this.#profile = profile;
  }

  public setProfile(profile: MotionProfile): void {
    if (profile === this.#profile) {
      return;
    }
    this.#profile = profile;
    this.finishAll();
  }

  public play(element: Element, rawPlan: MotionPlan): MotionHandle {
    const plan = adaptPlanToProfile(rawPlan, this.#profile);
    const key = this.#key(plan);
    const previous = this.#running.get(key);

    if (previous !== undefined) {
      if (plan.interruption === "ignore") {
        return previous.handle;
      }
      if (plan.interruption === "finish") {
        previous.handle.finish();
      } else {
        previous.handle.cancel();
      }
      this.#running.delete(key);
    }

    const handle =
      plan.durationMs === 0 ? this.#instant(element, plan) : this.#driver.animate(element, plan);
    this.#running.set(key, { plan, handle });
    void handle.finished.finally(() => {
      if (this.#running.get(key)?.handle === handle) {
        this.#running.delete(key);
      }
    });
    return handle;
  }

  public cancelScope(scopeId: string): void {
    for (const [key, running] of this.#running) {
      if (running.plan.scopeId === scopeId) {
        running.handle.cancel();
        this.#running.delete(key);
      }
    }
  }

  public cancelAll(): void {
    for (const running of this.#running.values()) {
      running.handle.cancel();
    }
    this.#running.clear();
  }

  /** Profile changes settle at exact final keyframes instead of freezing mid-flight. */
  public finishAll(): void {
    for (const running of this.#running.values()) {
      running.handle.finish();
    }
    this.#running.clear();
  }

  public get runningCount(): number {
    return this.#running.size;
  }

  #key(plan: MotionPlan): string {
    return `${plan.targetId}:${plan.channel}`;
  }

  #instant(element: Element, plan: MotionPlan): MotionHandle {
    if (element instanceof HTMLElement || element instanceof SVGElement) {
      for (const [property, value] of Object.entries(plan.keyframes)) {
        const finalValue = Array.isArray(value) ? value.at(-1) : value;
        if (finalValue !== undefined) {
          element.style.setProperty(property, String(finalValue));
        }
      }
    }
    return {
      finished: Promise.resolve(),
      cancel() {},
      finish() {},
    };
  }
}
