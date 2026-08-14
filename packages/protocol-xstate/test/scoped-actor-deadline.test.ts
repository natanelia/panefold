import { revision } from "@panefold/model";
import type { ProtocolScheduler } from "@panefold/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  createPersistenceWorkerActor,
  createScopedProtocolActor,
  createSurfaceTransferActor,
  createViewTransitionActor,
  type ProtocolActorPort,
  type TransferProtocolEvent,
} from "../src";

interface TimerEntry {
  readonly at: number;
  readonly order: number;
  readonly callback: () => void;
}

class DeterministicProtocolScheduler implements ProtocolScheduler {
  readonly cleared: unknown[] = [];
  readonly #timers = new Map<number, TimerEntry>();
  readonly #callbacks = new Map<number, () => void>();
  #time = 0;
  #nextHandle = 0;
  #nextOrder = 0;

  public now(): number {
    return this.#time;
  }

  public setTimeout(callback: () => void, delayMs: number): unknown {
    const handle = this.#nextHandle;
    this.#nextHandle += 1;
    this.#timers.set(handle, {
      at: this.#time + delayMs,
      order: this.#nextOrder,
      callback,
    });
    this.#callbacks.set(handle, callback);
    this.#nextOrder += 1;
    return handle;
  }

  public clearTimeout(handle: unknown): void {
    this.cleared.push(handle);
    if (typeof handle === "number") this.#timers.delete(handle);
  }

  public get pending(): number {
    return this.#timers.size;
  }

  /** Simulates a hostile scheduler invoking a callback after it was cleared. */
  public invokeRegistered(handle: number): void {
    const callback = this.#callbacks.get(handle);
    if (callback === undefined) throw new Error(`Unknown timer handle ${String(handle)}`);
    callback();
  }

  public advanceTo(time: number): void {
    if (!Number.isSafeInteger(time) || time < this.#time) {
      throw new RangeError("Virtual time must advance to a non-negative safe integer");
    }
    while (true) {
      const due = [...this.#timers.entries()]
        .filter(([, entry]) => entry.at <= time)
        .sort((left, right) => left[1].at - right[1].at || left[1].order - right[1].order)[0];
      if (due === undefined) break;
      const [handle, entry] = due;
      this.#timers.delete(handle);
      this.#time = entry.at;
      entry.callback();
    }
    this.#time = time;
  }
}

describe("scoped protocol deadlines", () => {
  it("uses the global scheduler when no scheduler is injected", () => {
    vi.useFakeTimers();
    try {
      const raw = recordingActor();
      const actor = createScopedProtocolActor({
        identity: {
          protocolId: "drag:system-deadline",
          kind: "drag",
          baseRevision: revision(0),
        },
        actor: raw.port,
        deadline: { afterMs: 5, event: { type: "TIMEOUT" } },
      });
      actor.start();

      vi.advanceTimersByTime(4);
      expect(raw.events).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(raw.events).toEqual([{ type: "TIMEOUT" }]);
      vi.advanceTimersByTime(1);
      expect(raw.events).toHaveLength(1);
      actor.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("delivers the typed addressed deadline event exactly at t through the actor path", () => {
    const scheduler = new DeterministicProtocolScheduler();
    scheduler.advanceTo(20);
    const identity = {
      protocolId: "view-transition:deadline",
      kind: "view-transition" as const,
      baseRevision: revision(2),
    };
    const actor = createScopedProtocolActor({
      identity,
      actor: createViewTransitionActor(),
      scheduler,
      deadline: { afterMs: 5, event: { type: "HIGHER_PRIORITY_COMMAND" } },
    });

    // Construction alone does not schedule a deadline.
    scheduler.advanceTo(21);
    expect(scheduler.pending).toBe(0);
    actor.start();
    actor.send({ identity, event: { type: "START" } });

    scheduler.advanceTo(25);
    expect(actor.getSnapshot().value).toBe("capturing-old");
    expect(actor.trace()).toHaveLength(1);

    scheduler.advanceTo(26);
    expect(actor.getSnapshot().value).toBe("skipped");
    expect(actor.trace().at(-1)).toMatchObject({
      event: "HIGHER_PRIORITY_COMMAND",
      state: "skipped",
      timestamp: 26,
    });
    expect(scheduler.pending).toBe(0);

    scheduler.advanceTo(27);
    expect(actor.trace()).toHaveLength(2);
    actor.stop();
  });

  it("rearms a deadline relative to the current scheduler time after the prior deadline fires", () => {
    const scheduler = new DeterministicProtocolScheduler();
    const raw = recordingActor();
    const actor = createScopedProtocolActor({
      identity: {
        protocolId: "drag:rearmed",
        kind: "drag",
        baseRevision: revision(0),
      },
      actor: raw.port,
      scheduler,
    });
    actor.start();

    expect(actor.scheduleDeadline({ afterMs: 2, event: { type: "TIMEOUT" } })).toBe(true);
    scheduler.advanceTo(2);
    expect(raw.events).toEqual([{ type: "TIMEOUT" }]);

    expect(actor.scheduleDeadline({ afterMs: 3, event: { type: "TIMEOUT" } })).toBe(true);
    scheduler.advanceTo(4);
    expect(raw.events).toHaveLength(1);
    scheduler.advanceTo(5);
    expect(raw.events).toEqual([{ type: "TIMEOUT" }, { type: "TIMEOUT" }]);
    actor.stop();
  });

  it("replaces a transfer phase deadline and ignores a stale callback from the prior phase", () => {
    const scheduler = new DeterministicProtocolScheduler();
    const raw = createSurfaceTransferActor();
    const rawStop = vi.spyOn(raw, "stop");
    const identity = {
      protocolId: "surface-transfer:phase-deadline",
      kind: "surface-transfer" as const,
      baseRevision: revision(0),
    };
    const actor = createScopedProtocolActor<TransferProtocolEvent>({
      identity,
      actor: raw,
      scheduler,
    });
    actor.start();
    actor.send({ identity, event: { type: "START", token: "transfer:phase-deadline" } });
    expect(actor.getSnapshot().value).toBe("preparing");
    expect(
      actor.scheduleDeadline({
        afterMs: 5,
        event: {
          type: "FAILED",
          stage: "prepare",
          message: "prepare timed out",
          cause: "timed-out",
        },
      }),
    ).toBe(true);

    scheduler.advanceTo(2);
    actor.send({ identity, event: { type: "PREPARED" } });
    expect(actor.getSnapshot().value).toBe("bootstrapping");
    expect(
      actor.scheduleDeadline({
        afterMs: 10,
        event: {
          type: "FAILED",
          stage: "bootstrap",
          message: "bootstrap timed out",
          cause: "timed-out",
        },
      }),
    ).toBe(true);
    expect(scheduler.cleared).toEqual([0]);

    // A scheduler that races clearTimeout may still invoke the old callback.
    scheduler.invokeRegistered(0);
    expect(actor.getSnapshot().value).toBe("bootstrapping");
    expect(actor.trace().at(-1)?.event).toBe("PREPARED");

    // The replacement is relative to the rearm at t=2, not actor start at t=0.
    scheduler.advanceTo(11);
    expect(actor.getSnapshot().value).toBe("bootstrapping");
    scheduler.advanceTo(12);
    expect(raw.getSnapshot().value).toBe("failed-safe");
    expect(actor.active).toBe(false);
    expect(rawStop).toHaveBeenCalledOnce();
    expect(actor.trace().at(-1)).toMatchObject({
      event: "FAILED",
      state: "failed-safe",
      timestamp: 12,
    });
    expect(actor.scheduleDeadline({ afterMs: 1, event: { type: "CANCEL" } })).toBe(false);
    expect(actor.cancelDeadline()).toBe(false);
  });

  it("cancels a phase deadline once and rejects a stale cancelled callback", () => {
    const scheduler = new DeterministicProtocolScheduler();
    const raw = recordingActor();
    const actor = createScopedProtocolActor({
      identity: {
        protocolId: "drag:cancelled-deadline",
        kind: "drag",
        baseRevision: revision(0),
      },
      actor: raw.port,
      scheduler,
    });
    actor.start();
    actor.scheduleDeadline({ afterMs: 4, event: { type: "TIMEOUT" } });

    expect(actor.cancelDeadline()).toBe(true);
    expect(actor.cancelDeadline()).toBe(false);
    expect(scheduler.cleared).toEqual([0]);
    scheduler.invokeRegistered(0);
    scheduler.advanceTo(5);
    expect(raw.events).toEqual([]);
    actor.stop();
  });

  it("clears a pending deadline once on explicit stop or parent abort and never sends it late", () => {
    const scheduler = new DeterministicProtocolScheduler();
    const stoppedRaw = recordingActor();
    const abortedRaw = recordingActor();
    const parent = new AbortController();
    const stopped = createScopedProtocolActor({
      identity: {
        protocolId: "drag:stopped",
        kind: "drag",
        baseRevision: revision(0),
      },
      actor: stoppedRaw.port,
      scheduler,
      deadline: { afterMs: 10, event: { type: "TIMEOUT" } },
    });
    const aborted = createScopedProtocolActor({
      identity: {
        protocolId: "drag:aborted",
        kind: "drag",
        baseRevision: revision(0),
      },
      actor: abortedRaw.port,
      parentSignal: parent.signal,
      scheduler,
      deadline: { afterMs: 10, event: { type: "TIMEOUT" } },
    });
    stopped.start();
    aborted.start();

    stopped.stop("cancelled");
    stopped.stop("duplicate");
    parent.abort("surface-disposed");
    aborted.stop("duplicate");

    expect(scheduler.cleared).toEqual([0, 1]);
    expect(scheduler.pending).toBe(0);
    scheduler.advanceTo(11);
    expect(stoppedRaw.events).toEqual([]);
    expect(abortedRaw.events).toEqual([]);
    expect(stoppedRaw.stop).toHaveBeenCalledOnce();
    expect(abortedRaw.stop).toHaveBeenCalledOnce();
    expect(stopped.scheduleDeadline({ afterMs: 1, event: { type: "TIMEOUT" } })).toBe(false);
    expect(aborted.scheduleDeadline({ afterMs: 1, event: { type: "TIMEOUT" } })).toBe(false);
    expect(stopped.cancelDeadline()).toBe(false);
    expect(aborted.cancelDeadline()).toBe(false);
  });

  it("closes immediately when a real XState actor reaches a final state before its deadline", () => {
    const scheduler = new DeterministicProtocolScheduler();
    const raw = createPersistenceWorkerActor();
    const rawStop = vi.spyOn(raw, "stop");
    const identity = {
      protocolId: "persistence:terminal",
      kind: "persistence-worker" as const,
      baseRevision: revision(0),
    };
    const actor = createScopedProtocolActor({
      identity,
      actor: raw,
      scheduler,
      deadline: { afterMs: 10, event: { type: "STOP" } },
    });
    actor.start();

    expect(actor.send({ identity, event: { type: "STOP" } })).toBe(true);
    expect(raw.getSnapshot().status).toBe("done");
    expect(actor.active).toBe(false);
    expect(actor.signal.reason).toBe("completed");
    expect(scheduler.cleared).toEqual([0]);
    expect(scheduler.pending).toBe(0);
    expect(rawStop).toHaveBeenCalledOnce();
    expect(actor.send({ identity, event: { type: "STOP" } })).toBe(false);
    scheduler.advanceTo(11);
    expect(actor.trace()).toHaveLength(1);
  });

  it("does not schedule a deadline for an actor that is terminal immediately after start", () => {
    const scheduler = new DeterministicProtocolScheduler();
    const stop = vi.fn();
    const send = vi.fn();
    const actor = createScopedProtocolActor({
      identity: {
        protocolId: "drag:initially-terminal",
        kind: "drag",
        baseRevision: revision(0),
      },
      actor: {
        start: () => undefined,
        stop,
        send,
        getSnapshot: () => ({ value: "completed", status: "done" }),
      },
      scheduler,
      deadline: { afterMs: 10, event: { type: "TIMEOUT" } },
    });

    actor.start();
    expect(actor.active).toBe(false);
    expect(actor.signal.reason).toBe("completed");
    expect(scheduler.pending).toBe(0);
    expect(scheduler.cleared).toEqual([]);
    expect(stop).toHaveBeenCalledOnce();
    expect(
      actor.send({
        identity: actor.identity,
        event: { type: "TIMEOUT" },
      }),
    ).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("preserves FIFO registration order for actors sharing a deterministic deadline", () => {
    const scheduler = new DeterministicProtocolScheduler();
    const order: string[] = [];
    const first = orderedActor("first", order);
    const second = orderedActor("second", order);
    const firstScoped = createScopedProtocolActor({
      identity: {
        protocolId: "drag:first",
        kind: "drag",
        baseRevision: revision(0),
      },
      actor: first,
      scheduler,
      deadline: { afterMs: 4, event: { type: "TIMEOUT" } },
    });
    const secondScoped = createScopedProtocolActor({
      identity: {
        protocolId: "drag:second",
        kind: "drag",
        baseRevision: revision(0),
      },
      actor: second,
      scheduler,
      deadline: { afterMs: 4, event: { type: "TIMEOUT" } },
    });

    firstScoped.start();
    secondScoped.start();
    scheduler.advanceTo(4);

    expect(order).toEqual(["first:TIMEOUT", "second:TIMEOUT"]);
    firstScoped.stop();
    secondScoped.stop();
  });

  it("fails closed when scheduling a phase deadline throws", () => {
    const raw = recordingActor();
    const failure = new Error("scheduler unavailable");
    const actor = createScopedProtocolActor({
      identity: {
        protocolId: "drag:scheduler-failure",
        kind: "drag",
        baseRevision: revision(0),
      },
      actor: raw.port,
      scheduler: {
        now: () => 0,
        setTimeout: () => {
          throw failure;
        },
        clearTimeout: vi.fn(),
      },
    });
    actor.start();

    expect(() => actor.scheduleDeadline({ afterMs: 10, event: { type: "TIMEOUT" } })).toThrow(
      failure,
    );
    expect(actor.active).toBe(false);
    expect(actor.signal.aborted).toBe(true);
    expect(raw.stop).toHaveBeenCalledOnce();
  });

  it("invalidates the old deadline and fails closed if replacement cleanup throws", () => {
    const raw = recordingActor();
    const failure = new Error("timer cleanup failed");
    let oldCallback: (() => void) | undefined;
    const clearTimeout = vi.fn(() => {
      throw failure;
    });
    const actor = createScopedProtocolActor({
      identity: {
        protocolId: "drag:replacement-cleanup-failure",
        kind: "drag",
        baseRevision: revision(0),
      },
      actor: raw.port,
      scheduler: {
        now: () => 0,
        setTimeout: (callback) => {
          oldCallback = callback;
          return 0;
        },
        clearTimeout,
      },
    });
    actor.start();
    actor.scheduleDeadline({ afterMs: 10, event: { type: "TIMEOUT" } });

    expect(() => actor.scheduleDeadline({ afterMs: 20, event: { type: "TIMEOUT" } })).toThrow(
      failure,
    );
    expect(actor.active).toBe(false);
    expect(actor.signal.reason).toBe(failure);
    expect(clearTimeout).toHaveBeenCalledOnce();
    expect(raw.stop).toHaveBeenCalledOnce();
    if (oldCallback === undefined) throw new Error("Expected the old deadline callback");
    oldCallback();
    expect(raw.events).toEqual([]);
  });

  it("rejects an invalid replacement without disturbing the active deadline", () => {
    const scheduler = new DeterministicProtocolScheduler();
    const raw = recordingActor();
    const actor = createScopedProtocolActor({
      identity: {
        protocolId: "drag:invalid-replacement",
        kind: "drag",
        baseRevision: revision(0),
      },
      actor: raw.port,
      scheduler,
    });
    actor.start();
    actor.scheduleDeadline({ afterMs: 3, event: { type: "TIMEOUT" } });

    expect(() => actor.scheduleDeadline({ afterMs: 3.5, event: { type: "TIMEOUT" } })).toThrow(
      RangeError,
    );
    expect(scheduler.pending).toBe(1);
    expect(scheduler.cleared).toEqual([]);
    scheduler.advanceTo(3);
    expect(raw.events).toEqual([{ type: "TIMEOUT" }]);
    actor.stop();
  });

  it.each(["send", "snapshot", "clock"] as const)(
    "fails closed when the %s boundary throws during delivery",
    (failurePoint) => {
      const scheduler = new DeterministicProtocolScheduler();
      const failure = new Error(`${failurePoint} failed`);
      const stop = vi.fn();
      let snapshotCalls = 0;
      const identity = {
        protocolId: `drag:${failurePoint}`,
        kind: "drag" as const,
        baseRevision: revision(0),
      };
      const actor = createScopedProtocolActor({
        identity,
        actor: {
          start: () => undefined,
          stop,
          send: () => {
            if (failurePoint === "send") throw failure;
          },
          getSnapshot: () => {
            snapshotCalls += 1;
            if (failurePoint === "snapshot" && snapshotCalls > 1) throw failure;
            return { value: "active", status: "active" };
          },
        },
        clock: {
          now: () => {
            if (failurePoint === "clock") throw failure;
            return 0;
          },
        },
        scheduler,
        deadline: { afterMs: 10, event: { type: "TIMEOUT" } },
      });
      actor.start();

      expect(() => actor.send({ identity, event: { type: "TIMEOUT" } })).toThrow(failure);
      expect(actor.active).toBe(false);
      expect(actor.signal.reason).toBe(failure);
      expect(scheduler.cleared).toEqual([0]);
      expect(scheduler.pending).toBe(0);
      expect(stop).toHaveBeenCalledOnce();
      expect(actor.send({ identity, event: { type: "TIMEOUT" } })).toBe(false);
    },
  );

  it("fails closed when the public snapshot boundary throws", () => {
    const failure = new Error("snapshot unavailable");
    const stop = vi.fn();
    let snapshotCalls = 0;
    const actor = createScopedProtocolActor({
      identity: {
        protocolId: "drag:snapshot-read",
        kind: "drag",
        baseRevision: revision(0),
      },
      actor: {
        start: () => undefined,
        stop,
        send: () => undefined,
        getSnapshot: () => {
          snapshotCalls += 1;
          if (snapshotCalls > 1) throw failure;
          return { value: "active", status: "active" };
        },
      },
    });
    actor.start();

    expect(() => actor.getSnapshot()).toThrow(failure);
    expect(actor.active).toBe(false);
    expect(actor.signal.reason).toBe(failure);
    expect(stop).toHaveBeenCalledOnce();
  });

  it.each([-1, 0.5, Number.NaN, 2_147_483_648, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid deadline delay %s",
    (afterMs) => {
      expect(() =>
        createScopedProtocolActor({
          identity: {
            protocolId: "drag:invalid",
            kind: "drag",
            baseRevision: revision(0),
          },
          actor: recordingActor().port,
          deadline: { afterMs, event: { type: "TIMEOUT" } },
        }),
      ).toThrow(RangeError);
    },
  );

  it("accepts the largest delay supported consistently by browser and Node timers", () => {
    const scheduler = new DeterministicProtocolScheduler();
    const actor = createScopedProtocolActor({
      identity: {
        protocolId: "drag:max-deadline",
        kind: "drag",
        baseRevision: revision(0),
      },
      actor: recordingActor().port,
      scheduler,
      deadline: { afterMs: 2_147_483_647, event: { type: "TIMEOUT" } },
    });

    actor.start();
    expect(scheduler.pending).toBe(1);
    actor.stop();
    expect(scheduler.cleared).toEqual([0]);
  });
});

interface TimeoutEvent {
  readonly type: "TIMEOUT";
}

function recordingActor(): {
  readonly port: ProtocolActorPort<TimeoutEvent>;
  readonly events: TimeoutEvent[];
  readonly stop: ReturnType<typeof vi.fn>;
} {
  const events: TimeoutEvent[] = [];
  const stop = vi.fn();
  return {
    events,
    stop,
    port: {
      start: vi.fn(),
      stop,
      send: (event) => events.push(event),
      getSnapshot: () => ({ value: "active" }),
    },
  };
}

function orderedActor(label: string, order: string[]): ProtocolActorPort<TimeoutEvent> {
  return {
    start: () => undefined,
    stop: () => undefined,
    send: (event) => order.push(`${label}:${event.type}`),
    getSnapshot: () => ({ value: "active" }),
  };
}
