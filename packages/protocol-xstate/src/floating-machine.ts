import type { Revision } from "@panefold/model";
import { assign, createActor, setup } from "xstate";

export interface FloatingPosition {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FloatingSnapCandidate {
  readonly id: string;
  readonly position: FloatingPosition;
}

export interface FloatingManipulationContext {
  readonly mode: "move" | "resize" | undefined;
  readonly pointerId: number | undefined;
  readonly baseRevision: Revision | undefined;
  readonly current: FloatingPosition | undefined;
  readonly snapCandidate: FloatingSnapCandidate | undefined;
  readonly viewportVersion: number;
  readonly failure: string | undefined;
}

export type FloatingManipulationEvent =
  | {
      readonly type: "START" | "REGRAB";
      readonly mode: "move" | "resize";
      readonly pointerId: number;
      readonly position: FloatingPosition;
      readonly baseRevision: Revision;
    }
  | { readonly type: "MOVE"; readonly pointerId: number; readonly position: FloatingPosition }
  | { readonly type: "SNAP_ACQUIRED"; readonly candidate: FloatingSnapCandidate }
  | { readonly type: "SNAP_RELEASED" }
  | { readonly type: "VIEWPORT_CHANGED"; readonly version: number }
  | {
      readonly type: "POINTER_END" | "POINTER_CANCEL" | "CAPTURE_LOST";
      readonly pointerId: number;
    }
  | { readonly type: "COMMIT_OK" | "SETTLED" | "CANCEL" | "RECOVERED" }
  | { readonly type: "REVISION_CONFLICT" }
  | { readonly type: "COMMIT_ERROR"; readonly message: string };

function validPosition(position: FloatingPosition): boolean {
  return (
    [position.x, position.y, position.width, position.height].every(Number.isFinite) &&
    position.width >= 0 &&
    position.height >= 0
  );
}

export const floatingManipulationMachine = setup({
  types: {
    context: {} as FloatingManipulationContext,
    events: {} as FloatingManipulationEvent,
  },
  guards: {
    matchingPointer: ({ context, event }) =>
      "pointerId" in event && event.pointerId === context.pointerId,
    validMove: ({ context, event }) =>
      event.type === "MOVE" &&
      event.pointerId === context.pointerId &&
      validPosition(event.position),
  },
  actions: {
    begin: assign(({ event }) =>
      event.type === "START" || event.type === "REGRAB"
        ? {
            mode: event.mode,
            pointerId: event.pointerId,
            baseRevision: event.baseRevision,
            current: event.position,
            snapCandidate: undefined,
            failure: undefined,
          }
        : {},
    ),
    move: assign(({ event }) => (event.type === "MOVE" ? { current: event.position } : {})),
    acquireSnap: assign(({ event }) =>
      event.type === "SNAP_ACQUIRED" && validPosition(event.candidate.position)
        ? { snapCandidate: event.candidate, current: event.candidate.position }
        : {},
    ),
    releaseSnap: assign({ snapCandidate: undefined }),
    updateViewport: assign(({ context, event }) =>
      event.type === "VIEWPORT_CHANGED" &&
      Number.isSafeInteger(event.version) &&
      event.version >= context.viewportVersion
        ? { viewportVersion: event.version }
        : {},
    ),
    fail: assign(({ event }) => {
      if (event.type === "COMMIT_ERROR") return { failure: event.message };
      if (event.type === "REVISION_CONFLICT") return { failure: "revision-conflict" };
      return { failure: "cancelled" };
    }),
    reset: assign({
      mode: undefined,
      pointerId: undefined,
      baseRevision: undefined,
      current: undefined,
      snapCandidate: undefined,
      failure: undefined,
    }),
  },
}).createMachine({
  id: "floating-manipulation",
  initial: "idle",
  context: {
    mode: undefined,
    pointerId: undefined,
    baseRevision: undefined,
    current: undefined,
    snapCandidate: undefined,
    viewportVersion: 0,
    failure: undefined,
  },
  states: {
    idle: {
      entry: "reset",
      on: { START: { target: "manipulating", actions: "begin" } },
    },
    manipulating: {
      on: {
        MOVE: { guard: "validMove", actions: "move" },
        SNAP_ACQUIRED: { target: "snapping", actions: "acquireSnap" },
        VIEWPORT_CHANGED: { actions: "updateViewport" },
        POINTER_END: { guard: "matchingPointer", target: "committing" },
        POINTER_CANCEL: { guard: "matchingPointer", target: "recovering", actions: "fail" },
        CAPTURE_LOST: { guard: "matchingPointer", target: "recovering", actions: "fail" },
        CANCEL: { target: "recovering", actions: "fail" },
      },
    },
    snapping: {
      on: {
        MOVE: { guard: "validMove", actions: "move" },
        SNAP_ACQUIRED: { actions: "acquireSnap" },
        SNAP_RELEASED: { target: "manipulating", actions: "releaseSnap" },
        VIEWPORT_CHANGED: { target: "manipulating", actions: ["updateViewport", "releaseSnap"] },
        POINTER_END: { guard: "matchingPointer", target: "committing" },
        POINTER_CANCEL: { guard: "matchingPointer", target: "recovering", actions: "fail" },
        CAPTURE_LOST: { guard: "matchingPointer", target: "recovering", actions: "fail" },
        CANCEL: { target: "recovering", actions: "fail" },
      },
    },
    committing: {
      on: {
        COMMIT_OK: { target: "settling" },
        COMMIT_ERROR: { target: "recovering", actions: "fail" },
        REVISION_CONFLICT: { target: "recovering", actions: "fail" },
        CANCEL: { target: "recovering", actions: "fail" },
      },
    },
    settling: {
      on: {
        SETTLED: { target: "idle" },
        REGRAB: { target: "manipulating", actions: "begin" },
        CANCEL: { target: "idle" },
      },
    },
    recovering: {
      on: {
        RECOVERED: { target: "idle" },
        REGRAB: { target: "manipulating", actions: "begin" },
      },
    },
  },
});

export function createFloatingManipulationActor() {
  return createActor(floatingManipulationMachine);
}
