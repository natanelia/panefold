import type { Revision } from "@panefold/model";
import { assign, createActor, setup } from "xstate";

export interface PointerPosition {
  readonly x: number;
  readonly y: number;
}

export interface DragCandidate {
  readonly id: string;
  readonly label: string;
}

export interface DragMachineInput {
  readonly threshold?: number;
}

export interface DragContext {
  readonly threshold: number;
  readonly pointerId: number | undefined;
  readonly baseRevision: Revision | undefined;
  readonly start: PointerPosition | undefined;
  readonly current: PointerPosition | undefined;
  readonly candidate: DragCandidate | undefined;
  readonly failure: string | undefined;
}

export type DragEvent =
  | {
      readonly type: "POINTER_DOWN";
      readonly pointerId: number;
      readonly position: PointerPosition;
      readonly baseRevision: Revision;
    }
  | {
      readonly type: "POINTER_MOVE";
      readonly pointerId: number;
      readonly position: PointerPosition;
    }
  | { readonly type: "SET_CANDIDATE"; readonly candidate: DragCandidate | undefined }
  | { readonly type: "POINTER_UP"; readonly pointerId: number }
  | { readonly type: "CANCEL" }
  | { readonly type: "POINTER_CANCEL"; readonly pointerId: number }
  | { readonly type: "CAPTURE_LOST"; readonly pointerId: number }
  | { readonly type: "COMMIT_OK" }
  | { readonly type: "COMMIT_ERROR"; readonly message: string }
  | { readonly type: "REVISION_CONFLICT" }
  | { readonly type: "SETTLED" }
  | {
      readonly type: "REGRAB";
      readonly pointerId: number;
      readonly position: PointerPosition;
      readonly baseRevision: Revision;
    }
  | { readonly type: "RETURNED" }
  | { readonly type: "RECOVERED" };

function isPointerEvent(
  event: DragEvent,
): event is Extract<DragEvent, { readonly pointerId: number }> {
  return "pointerId" in event;
}

export const dragMachine = setup({
  types: {
    context: {} as DragContext,
    events: {} as DragEvent,
    input: {} as DragMachineInput,
  },
  guards: {
    matchesPointer: ({ context, event }) =>
      isPointerEvent(event) && event.pointerId === context.pointerId,
    crossedThreshold: ({ context, event }) => {
      if (
        event.type !== "POINTER_MOVE" ||
        event.pointerId !== context.pointerId ||
        context.start === undefined
      ) {
        return false;
      }
      const inlineDelta = event.position.x - context.start.x;
      const blockDelta = event.position.y - context.start.y;
      return Math.hypot(inlineDelta, blockDelta) >= context.threshold;
    },
    matchesPointerWithCandidate: ({ context, event }) =>
      isPointerEvent(event) &&
      event.pointerId === context.pointerId &&
      context.candidate !== undefined,
  },
  actions: {
    arm: assign(({ event }) => {
      if (event.type !== "POINTER_DOWN" && event.type !== "REGRAB") {
        return {};
      }
      return {
        pointerId: event.pointerId,
        baseRevision: event.baseRevision,
        start: event.position,
        current: event.position,
        candidate: undefined,
        failure: undefined,
      };
    }),
    samplePointer: assign(({ event }) =>
      event.type === "POINTER_MOVE" ? { current: event.position } : {},
    ),
    setCandidate: assign(({ event }) =>
      event.type === "SET_CANDIDATE" ? { candidate: event.candidate } : {},
    ),
    rememberFailure: assign(({ event }) => {
      if (event.type === "COMMIT_ERROR") return { failure: event.message };
      if (event.type === "REVISION_CONFLICT") return { failure: "revision-conflict" };
      return {};
    }),
    reset: assign({
      pointerId: undefined,
      baseRevision: undefined,
      start: undefined,
      current: undefined,
      candidate: undefined,
      failure: undefined,
    }),
  },
}).createMachine({
  id: "workspace-drag",
  initial: "idle",
  context: ({ input }) => ({
    threshold:
      input.threshold === undefined || !Number.isFinite(input.threshold)
        ? 5
        : Math.max(0, input.threshold),
    pointerId: undefined,
    baseRevision: undefined,
    start: undefined,
    current: undefined,
    candidate: undefined,
    failure: undefined,
  }),
  states: {
    idle: {
      entry: "reset",
      on: {
        POINTER_DOWN: { target: "armed", actions: "arm" },
      },
    },
    armed: {
      on: {
        POINTER_MOVE: [
          {
            guard: "crossedThreshold",
            target: "dragging",
            actions: "samplePointer",
          },
          { guard: "matchesPointer", actions: "samplePointer" },
        ],
        POINTER_UP: { guard: "matchesPointer", target: "idle" },
        POINTER_CANCEL: { guard: "matchesPointer", target: "idle" },
        CAPTURE_LOST: { guard: "matchesPointer", target: "idle" },
        CANCEL: { target: "idle" },
      },
    },
    dragging: {
      on: {
        POINTER_MOVE: { guard: "matchesPointer", actions: "samplePointer" },
        SET_CANDIDATE: { actions: "setCandidate" },
        POINTER_UP: [
          { guard: "matchesPointerWithCandidate", target: "committing" },
          { guard: "matchesPointer", target: "cancelling" },
        ],
        POINTER_CANCEL: { guard: "matchesPointer", target: "cancelling" },
        CAPTURE_LOST: { guard: "matchesPointer", target: "cancelling" },
        CANCEL: { target: "cancelling" },
      },
    },
    committing: {
      on: {
        COMMIT_OK: { target: "settling" },
        COMMIT_ERROR: { target: "recovering", actions: "rememberFailure" },
        REVISION_CONFLICT: { target: "recovering", actions: "rememberFailure" },
        CANCEL: { target: "recovering" },
      },
    },
    settling: {
      on: {
        SETTLED: { target: "idle" },
        REGRAB: { target: "dragging", actions: "arm" },
        CANCEL: { target: "idle" },
      },
    },
    cancelling: {
      on: {
        RETURNED: { target: "idle" },
        REGRAB: { target: "dragging", actions: "arm" },
      },
    },
    recovering: {
      on: {
        RECOVERED: { target: "idle" },
      },
    },
  },
});

export function createDragActor(input: DragMachineInput = {}) {
  return createActor(dragMachine, { input });
}
