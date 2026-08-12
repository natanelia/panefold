import { revision } from "@panefold/model";
import { describe, expect, it } from "vitest";

import {
  createCoordinatorElectionActor,
  createPersistenceWorkerActor,
  createResizeActor,
  createSurfaceTransferActor,
  type TransferProtocolEvent,
} from "../src";

describe("resize protocol", () => {
  it("ignores the wrong pointer and cleans up cancellation", () => {
    const actor = createResizeActor();
    actor.start();
    actor.send({
      type: "POINTER_START",
      pointerId: 4,
      position: { inline: 100, block: 0 },
      baseRevision: revision(2),
    });
    actor.send({ type: "POINTER_MOVE", pointerId: 9, position: { inline: 150, block: 0 } });
    expect(actor.getSnapshot().value).toBe("armed");
    expect(actor.getSnapshot().context.current).toEqual({ inline: 100, block: 0 });

    actor.send({ type: "POINTER_MOVE", pointerId: 4, position: { inline: 120, block: 0 } });
    actor.send({ type: "CONSTRAINT_RESULT", position: { inline: 116, block: 0 } });
    expect(actor.getSnapshot().value).toBe("resizing");
    actor.send({ type: "CAPTURE_LOST", pointerId: 4 });
    expect(actor.getSnapshot().value).toBe("cancelling");
    actor.send({ type: "RETURNED" });
    expect(actor.getSnapshot().value).toBe("idle");
    expect(actor.getSnapshot().context.pointerId).toBeUndefined();
    actor.stop();
  });

  it("supports the same commit path for keyboard resizing", () => {
    const actor = createResizeActor();
    actor.start();
    actor.send({
      type: "KEYBOARD_START",
      position: { inline: 50, block: 0 },
      baseRevision: revision(0),
    });
    actor.send({ type: "KEYBOARD_STEP", position: { inline: 55, block: 0 } });
    actor.send({ type: "COMMIT" });
    actor.send({ type: "COMMIT_OK" });
    actor.send({ type: "SETTLED" });
    expect(actor.getSnapshot().value).toBe("idle");
    actor.stop();
  });
});

describe("surface transfer protocol", () => {
  const success: readonly TransferProtocolEvent[] = [
    { type: "START", token: "transfer:1" },
    { type: "PREPARED" },
    { type: "BOOTSTRAPPED" },
    { type: "CHECKPOINTED" },
    { type: "REVALIDATED" },
    { type: "OWNERSHIP_COMMITTED" },
    { type: "DESTINATION_MOUNTED" },
    { type: "DESTINATION_READY" },
    { type: "SOURCE_RELEASED" },
  ];

  it("follows prepare-before-commit and ready-before-release ordering", () => {
    const actor = createSurfaceTransferActor();
    actor.start();
    for (const event of success) actor.send(event);
    expect(actor.getSnapshot().value).toBe("completed");
    actor.stop();
  });

  it.each([
    [1, "prepare", "failed-safe"],
    [2, "bootstrap", "failed-safe"],
    [3, "checkpoint", "failed-safe"],
    [4, "revalidate", "failed-safe"],
    [5, "ownership-commit", "failed-safe"],
    [6, "destination-mount", "compensating"],
    [7, "destination-ready", "compensating"],
  ] as const)("handles failure after event %s at %s", (eventCount, stage, expected) => {
    const actor = createSurfaceTransferActor();
    actor.start();
    for (const event of success.slice(0, eventCount)) actor.send(event);
    actor.send({ type: "FAILED", stage, message: `failed:${stage}` });
    expect(actor.getSnapshot().value).toBe(expected);
    if (expected === "compensating") {
      actor.send({ type: "COMPENSATED" });
      expect(actor.getSnapshot().value).toBe("recovered");
    }
    actor.stop();
  });

  it("keeps destination ownership while source release is retried", () => {
    const actor = createSurfaceTransferActor();
    actor.start();
    for (const event of success.slice(0, -1)) actor.send(event);
    actor.send({ type: "FAILED", stage: "source-release", message: "source unavailable" });
    expect(actor.getSnapshot().value).toBe("source-release-retry");
    actor.send({ type: "RETRY_SOURCE_RELEASE" });
    actor.send({ type: "SOURCE_RELEASED" });
    expect(actor.getSnapshot().value).toBe("completed");
    actor.stop();
  });
});

describe("operational protocol actors", () => {
  it("bounds persistence queue admission and can recover from degraded mode", () => {
    const actor = createPersistenceWorkerActor({ queueLimit: 1 });
    actor.start();
    actor.send({ type: "ENQUEUE" });
    actor.send({ type: "ENQUEUE" });
    expect(actor.getSnapshot().value).toBe("degraded");
    actor.send({ type: "RETRY" });
    actor.send({ type: "RECOVERED" });
    expect(actor.getSnapshot().value).toBe("idle");
    expect(actor.getSnapshot().context.queueDepth).toBe(0);
    actor.stop();
  });

  it("rejects stale election epochs and steps down for a newer leader", () => {
    const actor = createCoordinatorElectionActor({ epoch: 3 });
    actor.start();
    actor.send({ type: "HEARTBEAT", epoch: 2 });
    expect(actor.getSnapshot().context.epoch).toBe(3);
    actor.send({ type: "TIMEOUT" });
    actor.send({ type: "PROPOSE", epoch: 4 });
    actor.send({ type: "WON", epoch: 4 });
    expect(actor.getSnapshot().value).toBe("leader");
    actor.send({ type: "HIGHER_EPOCH", epoch: 5 });
    expect(actor.getSnapshot().value).toBe("follower");
    expect(actor.getSnapshot().context.epoch).toBe(5);
    actor.stop();
  });

  it("does not elect a candidate without a strictly newer epoch", () => {
    const actor = createCoordinatorElectionActor({ epoch: 3 });
    actor.start();
    actor.send({ type: "TIMEOUT" });
    actor.send({ type: "PROPOSE", epoch: 3 });
    actor.send({ type: "WON", epoch: 3 });
    expect(actor.getSnapshot().value).toBe("candidate");
    expect(actor.getSnapshot().context.proposedEpoch).toBeUndefined();
    actor.stop();
  });
});
