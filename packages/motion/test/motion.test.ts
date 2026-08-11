import { describe, expect, it, vi } from "vitest";

import {
  adaptPlanToProfile,
  MotionCoordinator,
  type MotionDriver,
  type MotionHandle,
  type MotionPlan,
} from "../src";

const plan: MotionPlan = {
  targetId: "panel:map",
  channel: "layout",
  scopeId: "tx:1",
  keyframes: { transform: ["translateX(20px)", "none"], opacity: [0.8, 1] },
  durationMs: 200,
  interruption: "replace",
};

describe("motion contracts", () => {
  it("removes non-essential spatial motion in the reduced profile", () => {
    expect(adaptPlanToProfile(plan, "reduced")).toMatchObject({
      keyframes: { opacity: [0.8, 1] },
      durationMs: 90,
    });
    expect(adaptPlanToProfile(plan, "off").durationMs).toBe(0);
  });

  it("keeps one owner per target and channel", async () => {
    const cancel = vi.fn();
    const handles: MotionHandle[] = [];
    const driver: MotionDriver = {
      animate: () => {
        let resolve = () => {};
        const finished = new Promise<void>((done) => {
          resolve = done;
        });
        const handle = { finished, cancel, finish: resolve };
        handles.push(handle);
        return handle;
      },
    };
    const coordinator = new MotionCoordinator(driver);
    const element = {} as Element;
    coordinator.play(element, plan);
    const second = coordinator.play(element, { ...plan, durationMs: 140 });
    expect(cancel).toHaveBeenCalledOnce();
    expect(coordinator.runningCount).toBe(1);
    second.finish();
    await second.finished;
    expect(coordinator.runningCount).toBe(0);
  });

  it("finishes active motion when the accessibility profile changes", () => {
    const finish = vi.fn();
    const driver: MotionDriver = {
      animate: () => ({
        finished: new Promise<void>(() => {}),
        cancel: vi.fn(),
        finish,
      }),
    };
    const coordinator = new MotionCoordinator(driver);

    coordinator.play({} as Element, plan);
    coordinator.setProfile("reduced");

    expect(finish).toHaveBeenCalledOnce();
    expect(coordinator.runningCount).toBe(0);
  });
});
