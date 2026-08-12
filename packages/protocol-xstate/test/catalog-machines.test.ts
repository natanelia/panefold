import { revision } from "@panefold/model";
import { PROTOCOL_ACTOR_CATALOG, type WorkspaceProtocolKind } from "@panefold/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  createCloseActor,
  closeMachine,
  coordinatorElectionMachine,
  createFloatingManipulationActor,
  createKeyboardMoveActor,
  createPluginLoadActor,
  createScopedProtocolActor,
  createSurfaceRecoveryActor,
  createSuspendResumeActor,
  createViewTransitionActor,
  dragMachine,
  floatingManipulationMachine,
  keyboardMoveMachine,
  persistenceWorkerMachine,
  pluginLoadMachine,
  resizeMachine,
  surfaceRecoveryMachine,
  surfaceTransferMachine,
  suspendResumeMachine,
  viewTransitionMachine,
} from "../src";

describe("remaining protocol actor catalog", () => {
  it("implements every principal state in the public 12-actor catalog", () => {
    const machines = {
      drag: dragMachine,
      "splitter-resize": resizeMachine,
      "floating-manipulation": floatingManipulationMachine,
      "keyboard-move": keyboardMoveMachine,
      close: closeMachine,
      "suspend-resume": suspendResumeMachine,
      "surface-transfer": surfaceTransferMachine,
      "surface-recovery": surfaceRecoveryMachine,
      "persistence-worker": persistenceWorkerMachine,
      "plugin-load": pluginLoadMachine,
      "view-transition": viewTransitionMachine,
      "coordinator-election": coordinatorElectionMachine,
    } satisfies Record<
      WorkspaceProtocolKind,
      { readonly config: { readonly states?: object | undefined } }
    >;

    for (const [kind, descriptor] of Object.entries(PROTOCOL_ACTOR_CATALOG)) {
      expect(Object.keys(machines[kind as WorkspaceProtocolKind].config.states ?? {})).toEqual(
        expect.arrayContaining([...descriptor.principalStates]),
      );
    }
  });

  it("handles floating snap invalidation, commit, re-grab, and recovery", () => {
    const actor = createFloatingManipulationActor();
    actor.start();
    const start = {
      type: "START" as const,
      mode: "move" as const,
      pointerId: 4,
      position: { x: 10, y: 20, width: 300, height: 200 },
      baseRevision: revision(2),
    };
    actor.send(start);
    actor.send({
      type: "SNAP_ACQUIRED",
      candidate: {
        id: "snap:right",
        position: { x: 400, y: 0, width: 400, height: 600 },
      },
    });
    expect(actor.getSnapshot().value).toBe("snapping");
    actor.send({ type: "VIEWPORT_CHANGED", version: 2 });
    expect(actor.getSnapshot().value).toBe("manipulating");
    expect(actor.getSnapshot().context.snapCandidate).toBeUndefined();
    actor.send({ type: "POINTER_END", pointerId: 4 });
    actor.send({ type: "COMMIT_OK" });
    expect(actor.getSnapshot().value).toBe("settling");
    actor.send({
      type: "REGRAB",
      mode: "move",
      pointerId: 7,
      position: { x: 400, y: 0, width: 400, height: 600 },
      baseRevision: revision(3),
    });
    actor.send({ type: "CAPTURE_LOST", pointerId: 7 });
    expect(actor.getSnapshot().value).toBe("recovering");
    actor.send({ type: "RECOVERED" });
    expect(actor.getSnapshot().value).toBe("idle");
    actor.stop();
  });

  it("keeps keyboard movement semantic until commit and announces its result", () => {
    const actor = createKeyboardMoveActor();
    actor.start();
    actor.send({
      type: "START",
      baseRevision: revision(1),
      target: { id: "group:a", label: "Group A", targetClass: "group" },
    });
    actor.send({ type: "TARGET_INVALIDATED" });
    expect(actor.getSnapshot().value).toBe("cancelled");
    actor.send({
      type: "START",
      baseRevision: revision(1),
      target: { id: "region:main", label: "Main", targetClass: "region" },
    });
    actor.send({ type: "COMMIT" });
    actor.send({ type: "COMMIT_OK", announcement: "Moved to Main" });
    expect(actor.getSnapshot().value).toBe("announcing");
    expect(actor.getSnapshot().context.announcement).toBe("Moved to Main");
    actor.send({ type: "ANNOUNCED" });
    expect(actor.getSnapshot().value).toBe("idle");
    actor.stop();
  });

  it("does not close until guard, checkpoint, and undo preparation succeed", () => {
    const actor = createCloseActor();
    actor.start();
    actor.send({
      type: "REQUEST",
      requestId: "close:1",
      dirty: true,
      checkpointRequired: true,
      undoPreparationRequired: true,
    });
    actor.send({ type: "CHECK_GUARD" });
    actor.send({ type: "GUARD_ALLOWED" });
    actor.send({ type: "COMMIT" });
    expect(actor.getSnapshot().value).toBe("committing-close");
    actor.send({ type: "CHECKPOINTED" });
    actor.send({ type: "UNDO_PREPARED" });
    actor.send({ type: "COMMIT" });
    expect(actor.getSnapshot().value).toBe("visual-retirement");
    actor.send({ type: "VISUAL_FINISHED" });
    expect(actor.getSnapshot().value).toBe("disposed");
    actor.stop();

    const timeout = createCloseActor();
    timeout.start();
    timeout.send({ type: "REQUEST", requestId: "close:2", dirty: true });
    timeout.send({ type: "CHECK_GUARD" });
    timeout.send({ type: "GUARD_TIMEOUT" });
    expect(timeout.getSnapshot()).toMatchObject({
      value: "open",
      context: { failure: "timed-out" },
    });
    timeout.stop();
  });

  it("supports checkpointed suspension, failure retry, and resume", () => {
    const actor = createSuspendResumeActor();
    actor.start();
    actor.send({ type: "REQUEST_SUSPEND", reason: "budget", checkpointRequired: true });
    expect(actor.getSnapshot().value).toBe("suspend-requested");
    actor.send({ type: "BEGIN_CHECKPOINT" });
    actor.send({ type: "CHECKPOINT_FAILED", message: "busy" });
    expect(actor.getSnapshot().value).toBe("failed");
    actor.send({ type: "RETRY_SUSPEND" });
    actor.send({ type: "BEGIN_CHECKPOINT" });
    actor.send({ type: "CHECKPOINTED" });
    expect(actor.getSnapshot().value).toBe("suspended");
    actor.send({ type: "REQUEST_RESUME" });
    actor.send({ type: "RESUMED" });
    expect(actor.getSnapshot().value).toBe("mounted");
    actor.stop();
  });

  it("recovers an orphan only with ownership proof or explicit fallback", () => {
    const actor = createSurfaceRecoveryActor({ coordinatorEpoch: 2 });
    actor.start();
    actor.send({ type: "HEARTBEAT_LATE" });
    actor.send({ type: "DISCONNECTED" });
    actor.send({ type: "EPOCH_CHANGED", epoch: 3 });
    expect(actor.getSnapshot().value).toBe("orphaned");
    actor.send({ type: "BEGIN_RESOLUTION" });
    actor.send({ type: "OWNER_RECOVERED", ownershipProof: "" });
    expect(actor.getSnapshot().value).toBe("resolving");
    actor.send({ type: "FALLBACK_PLACED", placement: "region:recovery" });
    expect(actor.getSnapshot()).toMatchObject({
      value: "recovered",
      context: { coordinatorEpoch: 3, fallbackPlacement: "region:recovery" },
    });
    actor.stop();
  });

  it("contains plugin failures and unloads on scope closure", () => {
    const actor = createPluginLoadActor();
    actor.start();
    actor.send({ type: "REGISTER", pluginId: "plugin:map", version: "1.0.0" });
    actor.send({ type: "VALIDATED" });
    actor.send({ type: "LOAD_FAILED", message: "network" });
    expect(actor.getSnapshot()).toMatchObject({
      value: "failed",
      context: { failureKind: "load" },
    });
    actor.send({ type: "RETRY" });
    actor.send({ type: "VALIDATED" });
    actor.send({ type: "LOADED" });
    actor.send({ type: "REGISTERED" });
    expect(actor.getSnapshot().value).toBe("active");
    actor.send({ type: "SCOPE_CLOSED" });
    actor.send({ type: "UNLOADED" });
    expect(actor.getSnapshot().value).toBe("unregistered");
    actor.stop();
  });

  it("requires fallback commit after an unsupported or interrupted View Transition", () => {
    const unsupported = createViewTransitionActor();
    unsupported.start();
    unsupported.send({ type: "UNSUPPORTED" });
    expect(unsupported.getSnapshot()).toMatchObject({
      value: "skipped",
      context: { commitApplied: false, skipReason: "unsupported" },
    });
    unsupported.send({ type: "COMPLETE_SKIP" });
    expect(unsupported.getSnapshot().value).toBe("skipped");
    unsupported.send({ type: "FALLBACK_COMMITTED" });
    expect(unsupported.getSnapshot().value).toBe("completed");
    unsupported.stop();

    const interrupted = createViewTransitionActor();
    interrupted.start();
    interrupted.send({ type: "START" });
    interrupted.send({ type: "OLD_CAPTURED" });
    interrupted.send({ type: "COMMITTED" });
    interrupted.send({ type: "HIGHER_PRIORITY_COMMAND" });
    expect(interrupted.getSnapshot()).toMatchObject({
      value: "skipped",
      context: { commitApplied: true, skipReason: "interrupted" },
    });
    interrupted.send({ type: "COMPLETE_SKIP" });
    expect(interrupted.getSnapshot().value).toBe("completed");
    interrupted.stop();
  });
});

describe("scoped protocol actor ownership", () => {
  it("rejects stale identities, records deterministic traces, and stops once with its scope", () => {
    const parent = new AbortController();
    const raw = createViewTransitionActor();
    const rawStop = vi.spyOn(raw, "stop");
    const identity = {
      protocolId: "view-transition:1",
      kind: "view-transition" as const,
      baseRevision: revision(4),
      transactionId: "tx:4",
    };
    let time = 10;
    const actor = createScopedProtocolActor({
      identity,
      actor: raw,
      parentSignal: parent.signal,
      clock: { now: () => time++ },
      traceLimit: 2,
    });
    actor.start();

    expect(
      actor.send({
        identity: { ...identity, baseRevision: revision(3) },
        event: { type: "START" },
      }),
    ).toBe(false);
    expect(actor.send({ identity, event: { type: "START" } })).toBe(true);
    expect(actor.send({ identity, event: { type: "OLD_CAPTURED" } })).toBe(true);
    expect(actor.send({ identity, event: { type: "COMMITTED" } })).toBe(true);
    expect(actor.trace()).toMatchObject([
      { sequence: 1, state: "committing", event: "OLD_CAPTURED", timestamp: 11 },
      { sequence: 2, state: "capturing-new", event: "COMMITTED", timestamp: 12 },
    ]);

    parent.abort("surface-disposed");
    actor.stop("duplicate");
    expect(actor.active).toBe(false);
    expect(actor.signal.reason).toBe("surface-disposed");
    expect(rawStop).toHaveBeenCalledOnce();
    expect(actor.send({ identity, event: { type: "NEW_CAPTURED" } })).toBe(false);
  });

  it("never starts an actor when its parent scope is already disposed", () => {
    const parent = new AbortController();
    parent.abort("already-disposed");
    const raw = createViewTransitionActor();
    const rawStart = vi.spyOn(raw, "start");
    const actor = createScopedProtocolActor({
      identity: {
        protocolId: "view-transition:disposed",
        kind: "view-transition",
        baseRevision: revision(0),
      },
      actor: raw,
      parentSignal: parent.signal,
    });

    actor.start();
    expect(actor.active).toBe(false);
    expect(actor.signal.reason).toBe("already-disposed");
    expect(rawStart).not.toHaveBeenCalled();
  });
});
