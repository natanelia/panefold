import { describe, expect, it, vi } from "vitest";

import {
  adaptPlanToProfile,
  createFlipPlan,
  MotionCoordinator,
  SurfaceFrameScheduler,
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

  it("retargets from sampled visual state without an interruption jump", () => {
    const plans: MotionPlan[] = [];
    const cancel = vi.fn();
    const driver: MotionDriver = {
      sample: () => ({ transform: "translateX(7px)", opacity: 0.9 }),
      animate: (_element, next) => {
        plans.push(next);
        return { finished: new Promise<void>(() => {}), cancel, finish: vi.fn() };
      },
    };
    const coordinator = new MotionCoordinator(driver);
    const element = {} as Element;
    coordinator.play(element, plan);
    coordinator.play(element, { ...plan, scopeId: "tx:2" });

    expect(plans[1]?.keyframes).toEqual({
      transform: ["translateX(7px)", "none"],
      opacity: [0.9, 1],
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("creates content-aware FLIP plans from committed rectangles", () => {
    const flip = createFlipPlan({
      targetId: "panel:map",
      scopeId: "tx:move",
      before: { x: 10, y: 20, width: 200, height: 100 },
      after: { x: 30, y: 50, width: 400, height: 200 },
      strategy: "transform-content",
    });
    expect(flip.keyframes).toEqual({
      transform: ["translate(-20px, -30px) scale(0.5, 0.5)", "none"],
    });
    expect(flip.easing).toEqual([0.2, 0, 0, 1]);
  });

  it("coalesces pointer samples to one visual write per surface frame", () => {
    let frame: FrameRequestCallback | undefined;
    const cancelFrame = vi.fn();
    const writes: string[] = [];
    const scheduler = new SurfaceFrameScheduler({
      requestFrame: (callback) => {
        frame = callback;
        return 1;
      },
      cancelFrame,
      surfaceLimit: 2,
    });

    scheduler.schedule("surface:main", () => writes.push("old"));
    scheduler.schedule("surface:main", () => writes.push("latest"));
    scheduler.schedule("surface:float", () => writes.push("float"));
    expect(scheduler.schedule("surface:third", () => writes.push("third"))).toBe(false);
    frame?.(16);
    expect(writes).toEqual(["float", "latest"]);
    expect(scheduler.pendingSurfaceCount).toBe(0);
    expect(cancelFrame).not.toHaveBeenCalled();
  });

  it("isolates a surface write failure and still flushes later surfaces", () => {
    let frame: FrameRequestCallback | undefined;
    const failures: string[] = [];
    const writes: string[] = [];
    const scheduler = new SurfaceFrameScheduler({
      requestFrame: (callback) => {
        frame = callback;
        return 1;
      },
      onWriteError: (surfaceId) => failures.push(surfaceId),
    });
    scheduler.schedule("surface:a", () => {
      throw new Error("detached");
    });
    scheduler.schedule("surface:b", () => writes.push("b"));

    frame?.(16);
    expect(failures).toEqual(["surface:a"]);
    expect(writes).toEqual(["b"]);
  });
});
