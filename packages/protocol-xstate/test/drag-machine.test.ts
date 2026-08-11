import { revision } from "@panefold/model";
import { describe, expect, it } from "vitest";

import { createDragActor } from "../src";

describe("drag protocol", () => {
  it("creates an actor only for the active bounded interaction", () => {
    const actor = createDragActor({ threshold: 4 });
    actor.start();

    actor.send({
      type: "POINTER_DOWN",
      pointerId: 7,
      position: { x: 10, y: 10 },
      baseRevision: revision(3),
    });
    expect(actor.getSnapshot().value).toBe("armed");

    actor.send({ type: "POINTER_MOVE", pointerId: 7, position: { x: 12, y: 11 } });
    expect(actor.getSnapshot().value).toBe("armed");

    actor.send({ type: "POINTER_MOVE", pointerId: 7, position: { x: 16, y: 10 } });
    expect(actor.getSnapshot().value).toBe("dragging");

    actor.send({
      type: "SET_CANDIDATE",
      candidate: { id: "group:inspector", label: "Move to Inspector" },
    });
    actor.send({ type: "POINTER_UP", pointerId: 7 });
    expect(actor.getSnapshot().value).toBe("committing");

    actor.send({ type: "COMMIT_OK" });
    expect(actor.getSnapshot().value).toBe("settling");
    actor.send({ type: "SETTLED" });
    expect(actor.getSnapshot().value).toBe("idle");
    expect(actor.getSnapshot().context.pointerId).toBeUndefined();

    actor.stop();
  });

  it("cancels on capture loss without committing", () => {
    const actor = createDragActor({ threshold: 0 });
    actor.start();
    actor.send({
      type: "POINTER_DOWN",
      pointerId: 1,
      position: { x: 0, y: 0 },
      baseRevision: revision(0),
    });
    actor.send({ type: "POINTER_MOVE", pointerId: 1, position: { x: 1, y: 0 } });
    actor.send({ type: "CAPTURE_LOST", pointerId: 1 });
    expect(actor.getSnapshot().value).toBe("cancelling");
    actor.send({ type: "RETURNED" });
    expect(actor.getSnapshot().value).toBe("idle");
    actor.stop();
  });

  it("ignores move, end, and cancellation events from a different pointer", () => {
    const actor = createDragActor({ threshold: 4 });
    actor.start();
    actor.send({
      type: "POINTER_DOWN",
      pointerId: 7,
      position: { x: 10, y: 10 },
      baseRevision: revision(3),
    });

    actor.send({ type: "POINTER_MOVE", pointerId: 99, position: { x: 30, y: 10 } });
    expect(actor.getSnapshot().value).toBe("armed");
    expect(actor.getSnapshot().context.current).toEqual({ x: 10, y: 10 });

    actor.send({ type: "POINTER_MOVE", pointerId: 7, position: { x: 20, y: 10 } });
    actor.send({
      type: "SET_CANDIDATE",
      candidate: { id: "group:inspector", label: "Move to Inspector" },
    });
    expect(actor.getSnapshot().value).toBe("dragging");

    actor.send({ type: "POINTER_UP", pointerId: 99 });
    actor.send({ type: "POINTER_CANCEL", pointerId: 99 });
    actor.send({ type: "CAPTURE_LOST", pointerId: 99 });
    expect(actor.getSnapshot().value).toBe("dragging");
    expect(actor.getSnapshot().context.pointerId).toBe(7);

    actor.send({ type: "POINTER_UP", pointerId: 7 });
    expect(actor.getSnapshot().value).toBe("committing");
    actor.stop();
  });

  it("uses the default threshold for non-finite input", () => {
    const actor = createDragActor({ threshold: Number.NaN });
    actor.start();
    expect(actor.getSnapshot().context.threshold).toBe(5);
    actor.stop();
  });
});
