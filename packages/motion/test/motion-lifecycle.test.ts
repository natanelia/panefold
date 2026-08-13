// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  adaptPlanToLoad,
  MotionCoordinator,
  planMotionForLoad,
  startProgressiveViewTransition,
  type BrowserViewTransition,
  type MotionDriver,
  type MotionHandle,
  type MotionPlan,
} from "../src";

const basePlan: MotionPlan = {
  targetId: "panel:map",
  channel: "layout",
  scopeId: "tx:1",
  keyframes: { transform: ["translateX(20px)", "none"], opacity: [0.8, 1] },
  durationMs: 240,
  interruption: "retarget",
  salience: "spatial-continuity",
};

describe("managed motion lifecycle", () => {
  it("supports exactly-once explicit skip and driver cleanup", async () => {
    const skip = vi.fn();
    const dispose = vi.fn();
    const driver: MotionDriver = {
      animate: () => ({
        finished: new Promise<void>(() => undefined),
        cancel: vi.fn(),
        finish: vi.fn(),
        skip,
        dispose,
      }),
    };
    const coordinator = new MotionCoordinator(driver);
    const lease = coordinator.play(document.createElement("div"), basePlan);

    lease.skip();
    lease.skip();
    await lease.finished;

    expect(lease.status).toBe("skipped");
    expect(skip).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(coordinator.runningCount).toBe(0);
  });

  it("queues deliberate motion and disposes queued and running work by scope", async () => {
    const rawHandles: MotionHandle[] = [];
    const driver: MotionDriver = {
      animate: () => {
        const handle = {
          finished: new Promise<void>(() => undefined),
          cancel: vi.fn(),
          finish: vi.fn(),
          dispose: vi.fn(),
        };
        rawHandles.push(handle);
        return handle;
      },
    };
    const coordinator = new MotionCoordinator(driver);
    const element = document.createElement("div");
    const first = coordinator.play(element, basePlan);
    const queued = coordinator.play(element, { ...basePlan, interruption: "queue" });

    expect(queued.status).toBe("queued");
    expect(coordinator.queuedCount).toBe(1);
    first.finish();
    expect(rawHandles).toHaveLength(2);
    expect(queued.status).toBe("running");

    coordinator.disposeScope("tx:1");
    coordinator.disposeScope("tx:1");
    await queued.finished;
    expect(queued.status).toBe("disposed");
    expect(rawHandles[1]?.cancel).toHaveBeenCalledOnce();
    expect(rawHandles[1]?.dispose).toHaveBeenCalledOnce();
    expect(coordinator.runningCount).toBe(0);
    expect(coordinator.queuedCount).toBe(0);
  });

  it("bounds deliberate motion queues while preserving the newest final state", async () => {
    const completions: (() => void)[] = [];
    const driver: MotionDriver = {
      animate: (target, plan) => {
        let complete = () => undefined;
        const finished = new Promise<void>((resolve) => {
          complete = () => {
            for (const [property, values] of Object.entries(plan.keyframes)) {
              const value = Array.isArray(values) ? values.at(-1) : values;
              if (value !== undefined)
                (target as HTMLElement).style.setProperty(property, String(value));
            }
            resolve();
          };
        });
        completions.push(complete);
        return { finished, cancel: vi.fn(), finish: complete };
      },
    };
    const coordinator = new MotionCoordinator(driver, "productive", { queueLimit: 1 });
    const element = document.createElement("div");
    const running = coordinator.play(element, basePlan);
    const admitted = coordinator.play(element, { ...basePlan, interruption: "queue" });
    const newest = coordinator.play(element, {
      ...basePlan,
      interruption: "queue",
      keyframes: { opacity: [0, 0.5] },
    });

    expect(admitted.status).toBe("cancelled");
    expect(newest.status).toBe("queued");
    expect(coordinator.queuedCount).toBe(1);
    completions[0]?.();
    await running.finished;
    expect(newest.status).toBe("running");
    expect(element.style.opacity).toBe("1");
    completions[1]?.();
    await newest.finished;
    expect(element.style.opacity).toBe("0.5");
    expect(coordinator.queuedCount).toBe(0);
    expect(coordinator.runningCount).toBe(0);
  });

  it("replaces running motion with the newest intent when queue capacity is zero", async () => {
    const driver: MotionDriver = {
      animate: () => ({
        finished: new Promise<void>(() => undefined),
        cancel: vi.fn(),
        finish: vi.fn(),
      }),
    };
    const coordinator = new MotionCoordinator(driver, "productive", { queueLimit: 0 });
    const element = document.createElement("div");
    const first = coordinator.play(element, basePlan);
    const newest = coordinator.play(element, { ...basePlan, interruption: "queue" });

    expect(first.status).toBe("cancelled");
    expect(newest.status).toBe("running");
    expect(coordinator.runningCount).toBe(1);
    expect(coordinator.queuedCount).toBe(0);
    coordinator.dispose();
    await newest.finished;
  });

  it("validates the motion queue limit", () => {
    const driver: MotionDriver = {
      animate: () => ({
        finished: Promise.resolve(),
        cancel: vi.fn(),
        finish: vi.fn(),
      }),
    };
    expect(() => new MotionCoordinator(driver, "productive", { queueLimit: -1 })).toThrow(
      /queueLimit/,
    );
  });

  it("keeps queued counts exact through repeated queued cancellation races", () => {
    const driver: MotionDriver = {
      animate: () => ({
        finished: new Promise<void>(() => undefined),
        cancel: vi.fn(),
        finish: vi.fn(),
      }),
    };
    const coordinator = new MotionCoordinator(driver, "productive", { queueLimit: 3 });
    const element = document.createElement("div");
    coordinator.play(element, basePlan);
    const queued = Array.from({ length: 3 }, (_, index) =>
      coordinator.play(element, {
        ...basePlan,
        scopeId: `queued:${String(index)}`,
        interruption: "queue",
      }),
    );

    expect(coordinator.queuedCount).toBe(3);
    queued[1]?.cancel();
    queued[1]?.dispose();
    expect(coordinator.queuedCount).toBe(2);
    coordinator.cancelAll();
    coordinator.cancelAll();
    expect(coordinator.queuedCount).toBe(0);
    expect(coordinator.runningCount).toBe(0);
  });

  it("reveals final committed projection when a driver starts or finishes with failure", async () => {
    const failures: unknown[] = [];
    const driver: MotionDriver = {
      animate: () => ({
        finished: Promise.reject(new Error("animation detached")),
        cancel: vi.fn(),
        finish: vi.fn(),
      }),
    };
    const coordinator = new MotionCoordinator(driver, "productive", {
      onMotionError: ({ cause }) => failures.push(cause),
    });
    const element = document.createElement("div");
    const lease = coordinator.play(element, basePlan);
    await lease.finished;

    expect(lease.status).toBe("failed");
    expect(element.style.transform).toBe("none");
    expect(element.style.opacity).toBe("1");
    expect(failures).toHaveLength(1);
    expect(coordinator.runningCount).toBe(0);

    const throwing = new MotionCoordinator(
      {
        animate: () => {
          throw new Error("driver unavailable");
        },
      },
      "productive",
      {
        onMotionError: () => {
          throw new Error("observer failure");
        },
      },
    );
    const fallbackElement = document.createElement("div");
    const failedBeforeStart = throwing.play(fallbackElement, basePlan);
    await failedBeforeStart.finished;
    expect(failedBeforeStart.status).toBe("failed");
    expect(fallbackElement.style.transform).toBe("none");
  });
});

describe("load-adaptive planning", () => {
  it("degrades decoration before continuity and never changes direct tracking", () => {
    const decoration = { ...basePlan, targetId: "guide", salience: "decoration" as const };
    const direct = { ...basePlan, targetId: "drag", salience: "direct-input" as const };
    const constrained = planMotionForLoad([decoration, basePlan, direct], {
      frameBudgetMs: 16,
      observedFrameMs: 13,
      changedEntityCount: 8,
    });

    expect(
      constrained.map(({ pressure, decision, plan }) => [pressure, decision, plan.durationMs]),
    ).toEqual([
      ["constrained", "decoration-skipped", 0],
      ["constrained", "preserved", 240],
      ["constrained", "preserved", 240],
    ]);
    expect(constrained[2]?.plan).toBe(direct);

    const critical = planMotionForLoad([decoration, basePlan, direct], {
      frameBudgetMs: 8,
      observedFrameMs: 9,
      changedEntityCount: 120,
      heavyContentCount: 4,
    });
    expect(critical.map(({ decision, plan }) => [decision, plan.durationMs])).toEqual([
      ["decoration-skipped", 0],
      ["spatial-shortened", 140],
      ["preserved", 240],
    ]);
    expect(critical[2]?.plan).toBe(direct);
  });

  it("rejects invalid load evidence instead of silently selecting a tier", () => {
    expect(() =>
      adaptPlanToLoad(basePlan, {
        frameBudgetMs: 0,
        observedFrameMs: 1,
        changedEntityCount: 1,
      }),
    ).toThrow(/frameBudgetMs/u);
  });
});

describe("progressive View Transition", () => {
  it("commits exactly once and uses fallback when the API is unsupported", async () => {
    const commit = vi.fn();
    const fallback = vi.fn(() => undefined);
    const lease = startProgressiveViewTransition({ host: {}, commit, fallback });

    await lease.committed;
    await lease.ready;
    await lease.finished;

    expect(commit).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledWith("unsupported");
    expect(lease.enhancement).toBe("fallback");
    expect(lease.status).toBe("completed");
  });

  it("falls back after synchronous start or asynchronous capture failure", async () => {
    const diagnostics: string[] = [];
    const startFailureCommit = vi.fn();
    const startFailure = startProgressiveViewTransition({
      host: {
        startViewTransition: () => {
          throw new Error("blocked");
        },
      },
      commit: startFailureCommit,
      onDiagnostic: ({ reason }) => diagnostics.push(reason),
    });
    await startFailure.finished;
    await startFailure.committed;
    expect(startFailureCommit).toHaveBeenCalledOnce();
    expect(startFailure.status).toBe("completed");

    const transition = controllableViewTransition();
    const captureCommit = vi.fn();
    const fallback = vi.fn(() => undefined);
    const captureFailure = startProgressiveViewTransition({
      host: {
        startViewTransition: (update) => {
          void update();
          return transition.value;
        },
      },
      commit: captureCommit,
      fallback,
      onDiagnostic: ({ reason }) => diagnostics.push(reason),
    });
    transition.rejectReady(new Error("duplicate view-transition-name"));
    await captureFailure.finished;
    await captureFailure.committed;
    expect(captureCommit).toHaveBeenCalledOnce();
    expect(transition.skip).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledWith("ready-rejected");
    expect(diagnostics).toEqual(["start-failed", "ready-rejected"]);
  });

  it("still commits when a host rejects its update without invoking the callback", async () => {
    const transition = controllableViewTransition();
    const commit = vi.fn();
    const fallback = vi.fn(() => undefined);
    const lease = startProgressiveViewTransition({
      host: { startViewTransition: () => transition.value },
      commit,
      fallback,
    });

    transition.rejectUpdate(new Error("browser update failure"));
    await lease.committed;
    await lease.finished;

    expect(commit).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledWith("update-rejected");
    expect(lease.status).toBe("completed");
  });

  it("supports explicit skip and idempotent disposal without suppressing commit", async () => {
    const transition = controllableViewTransition();
    const commit = vi.fn();
    const fallback = vi.fn(() => undefined);
    const lease = startProgressiveViewTransition({
      host: {
        startViewTransition: (update) => {
          void update();
          return transition.value;
        },
      },
      commit,
      fallback,
    });

    lease.skip();
    lease.skip();
    await lease.committed;
    await lease.finished;
    expect(commit).toHaveBeenCalledOnce();
    expect(transition.skip).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledWith("explicit-skip");
    expect(lease.status).toBe("skipped");

    const disposedTransition = controllableViewTransition();
    const disposedCommit = vi.fn();
    const disposed = startProgressiveViewTransition({
      host: {
        startViewTransition: (update) => {
          void update();
          return disposedTransition.value;
        },
      },
      commit: disposedCommit,
    });
    disposed.dispose();
    disposed.dispose();
    await disposed.finished;
    await disposed.committed;
    expect(disposedCommit).toHaveBeenCalledOnce();
    expect(disposedTransition.skip).toHaveBeenCalledOnce();
    expect(disposed.status).toBe("disposed");
  });
});

function controllableViewTransition(): {
  readonly value: BrowserViewTransition;
  readonly skip: ReturnType<typeof vi.fn>;
  resolveReady(): void;
  rejectReady(cause: unknown): void;
  resolveUpdate(): void;
  rejectUpdate(cause: unknown): void;
  resolveFinished(): void;
  rejectFinished(cause: unknown): void;
} {
  const ready = deferred();
  const update = deferred();
  const finished = deferred();
  const skip = vi.fn();
  return {
    value: {
      ready: ready.promise,
      updateCallbackDone: update.promise,
      finished: finished.promise,
      skipTransition: skip,
    },
    skip,
    resolveReady: ready.resolve,
    rejectReady: ready.reject,
    resolveUpdate: update.resolve,
    rejectUpdate: update.reject,
    resolveFinished: finished.resolve,
    rejectFinished: finished.reject,
  };
}

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (cause: unknown) => void;
} {
  let resolve: () => void = () => undefined;
  let reject: (cause: unknown) => void = () => undefined;
  const promise = new Promise<void>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}
