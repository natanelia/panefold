import { revision } from "@panefold/model";
import { describe, expect, it } from "vitest";

import {
  createCoordinatorElectionActor,
  createFloatingManipulationActor,
  createKeyboardMoveActor,
  createPersistenceWorkerActor,
  createSurfaceTransferActor,
  createViewTransitionActor,
  type PersistenceWorkerEvent,
  type TransferProtocolEvent,
} from "../src";

const floatingStart = {
  type: "START" as const,
  mode: "move" as const,
  pointerId: 4,
  position: { x: 10, y: 20, width: 300, height: 200 },
  baseRevision: revision(2),
};

describe("bounded protocol correctness paths", () => {
  it("cancels floating manipulation for the owning pointer and recovers revision conflicts", () => {
    const cancelled = createFloatingManipulationActor();
    cancelled.start();
    cancelled.send(floatingStart);
    cancelled.send({ type: "POINTER_CANCEL", pointerId: 99 });
    expect(cancelled.getSnapshot().value).toBe("manipulating");
    cancelled.send({ type: "POINTER_CANCEL", pointerId: 4 });
    expect(cancelled.getSnapshot()).toMatchObject({
      value: "recovering",
      context: { failure: "cancelled" },
    });
    cancelled.stop();

    const conflicted = createFloatingManipulationActor();
    conflicted.start();
    conflicted.send(floatingStart);
    conflicted.send({ type: "POINTER_END", pointerId: 4 });
    conflicted.send({ type: "REVISION_CONFLICT" });
    expect(conflicted.getSnapshot()).toMatchObject({
      value: "recovering",
      context: { failure: "revision-conflict" },
    });
    conflicted.send({ type: "RECOVERED" });
    expect(conflicted.getSnapshot().value).toBe("idle");
    conflicted.stop();
  });

  it("rejects a stale keyboard target during commit", () => {
    const actor = createKeyboardMoveActor();
    actor.start();
    actor.send({
      type: "START",
      baseRevision: revision(3),
      target: { id: "group:b", label: "Group B", targetClass: "group" },
    });
    actor.send({ type: "COMMIT" });
    actor.send({ type: "REVISION_CONFLICT" });
    expect(actor.getSnapshot()).toMatchObject({
      value: "cancelled",
      context: { failure: "revision-conflict", target: undefined },
    });
    actor.stop();
  });

  it("ignores transfer failures addressed to the wrong stage and retains typed causes", () => {
    const actor = createSurfaceTransferActor();
    actor.start();
    actor.send({ type: "START", token: "transfer:guarded" });
    actor.send({
      type: "FAILED",
      stage: "bootstrap",
      cause: "protocol-mismatch",
      message: "wrong stage",
    });
    expect(actor.getSnapshot()).toMatchObject({
      value: "preparing",
      context: { failure: undefined, failureCause: undefined, failureStage: undefined },
    });

    actor.send({
      type: "FAILED",
      stage: "prepare",
      cause: "popup-blocked",
      message: "popup blocked",
    });
    expect(actor.getSnapshot()).toMatchObject({
      value: "failed-safe",
      context: {
        failure: "popup blocked",
        failureCause: "popup-blocked",
        failureStage: "prepare",
      },
    });
    actor.stop();
  });

  it("classifies failed compensation without erasing the original transfer failure", () => {
    const actor = createSurfaceTransferActor();
    actor.start();
    const toDestinationMount: readonly TransferProtocolEvent[] = [
      { type: "START", token: "transfer:compensation" },
      { type: "PREPARED" },
      { type: "BOOTSTRAPPED" },
      { type: "CHECKPOINTED" },
      { type: "REVALIDATED" },
      { type: "OWNERSHIP_COMMITTED" },
    ];
    for (const event of toDestinationMount) actor.send(event);
    actor.send({
      type: "FAILED",
      stage: "destination-mount",
      cause: "destination-closed",
      message: "destination closed",
    });
    actor.send({ type: "COMPENSATION_FAILED" });
    expect(actor.getSnapshot()).toMatchObject({
      value: "failed-safe",
      context: { failure: "destination closed", failureCause: "compensation-failed" },
    });
    actor.stop();
  });

  it("classifies persistence failures and clears the classification after recovery", () => {
    const actor = createPersistenceWorkerActor();
    actor.start();
    actor.send({ type: "ENQUEUE" });
    actor.send({ type: "STORAGE_ERROR", kind: "quota", message: "quota exceeded" });
    expect(actor.getSnapshot()).toMatchObject({
      value: "degraded",
      context: { failureKind: "quota", failure: "quota exceeded" },
    });
    actor.send({ type: "RETRY" });
    actor.send({ type: "RECOVERED" });
    expect(actor.getSnapshot()).toMatchObject({
      value: "idle",
      context: { failureKind: undefined, failure: undefined },
    });
    actor.stop();
  });

  it("stops the persistence worker from every live operational phase", () => {
    const paths: readonly (readonly PersistenceWorkerEvent[])[] = [
      [],
      [{ type: "ENQUEUE" }],
      [{ type: "ENQUEUE" }, { type: "FLUSH" }],
      [{ type: "ENQUEUE" }, { type: "FLUSH" }, { type: "SNAPSHOT_DUE" }],
      [{ type: "ENQUEUE" }, { type: "FLUSH" }, { type: "SNAPSHOT_DUE" }, { type: "COMPACT" }],
      [{ type: "ENQUEUE" }, { type: "STORAGE_ERROR", message: "offline" }],
      [{ type: "ENQUEUE" }, { type: "STORAGE_ERROR", message: "offline" }, { type: "RETRY" }],
    ];

    for (const path of paths) {
      const actor = createPersistenceWorkerActor();
      actor.start();
      for (const event of path) actor.send(event);
      actor.send({ type: "STOP" });
      expect(actor.getSnapshot().value).toBe("stopped");
      actor.stop();
    }
  });

  it("steps down for election conflicts and explicit server authority", () => {
    const conflict = createCoordinatorElectionActor({ epoch: 3 });
    conflict.start();
    conflict.send({ type: "TIMEOUT" });
    conflict.send({ type: "CONFLICT", epoch: 3 });
    expect(conflict.getSnapshot()).toMatchObject({ value: "follower", context: { epoch: 3 } });
    conflict.stop();

    const authority = createCoordinatorElectionActor({ epoch: 3 });
    authority.start();
    authority.send({ type: "TIMEOUT" });
    authority.send({ type: "PROPOSE", epoch: 4 });
    authority.send({ type: "WON", epoch: 4 });
    authority.send({ type: "SERVER_AUTHORITY", epoch: 3 });
    expect(authority.getSnapshot().value).toBe("leader");
    authority.send({ type: "SERVER_AUTHORITY", epoch: 5 });
    expect(authority.getSnapshot()).toMatchObject({ value: "follower", context: { epoch: 5 } });
    authority.stop();
  });

  it("falls back on timeout before commit and completes directly after driver failure post-commit", () => {
    const timedOut = createViewTransitionActor();
    timedOut.start();
    timedOut.send({ type: "START" });
    timedOut.send({ type: "TIMED_OUT" });
    expect(timedOut.getSnapshot()).toMatchObject({
      value: "skipped",
      context: { commitApplied: false, skipReason: "timed-out" },
    });
    timedOut.send({ type: "COMPLETE_SKIP" });
    expect(timedOut.getSnapshot().value).toBe("skipped");
    timedOut.send({ type: "FALLBACK_COMMITTED" });
    expect(timedOut.getSnapshot().value).toBe("completed");
    timedOut.stop();

    const driverFailed = createViewTransitionActor();
    driverFailed.start();
    driverFailed.send({ type: "START" });
    driverFailed.send({ type: "OLD_CAPTURED" });
    driverFailed.send({ type: "COMMITTED" });
    driverFailed.send({ type: "DRIVER_FAILED" });
    expect(driverFailed.getSnapshot()).toMatchObject({
      value: "skipped",
      context: { commitApplied: true, skipReason: "driver-failed" },
    });
    driverFailed.send({ type: "COMPLETE_SKIP" });
    expect(driverFailed.getSnapshot().value).toBe("completed");
    driverFailed.stop();
  });

  it("honors known explicit View Transition skip reasons and bounds unknown strings", () => {
    const known = createViewTransitionActor();
    known.start();
    known.send({ type: "SKIP", reason: "budget-rejected" });
    expect(known.getSnapshot().context.skipReason).toBe("budget-rejected");
    known.stop();

    const unknown = createViewTransitionActor();
    unknown.start();
    unknown.send({ type: "SKIP", reason: "application-specific" });
    expect(unknown.getSnapshot().context.skipReason).toBe("explicit-skip");
    unknown.stop();
  });
});
