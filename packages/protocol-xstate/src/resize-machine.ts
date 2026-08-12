import type { Revision } from "@panefold/model";
import { assign, createActor, setup } from "xstate";

export interface ResizeSample {
  readonly inline: number;
  readonly block: number;
}

export interface ResizeContext {
  readonly pointerId: number | undefined;
  readonly baseRevision: Revision | undefined;
  readonly current: ResizeSample | undefined;
  readonly constrained: ResizeSample | undefined;
  readonly input: "pointer" | "keyboard" | undefined;
  readonly failure: string | undefined;
}

export type ResizeEvent =
  | {
      readonly type: "POINTER_START";
      readonly pointerId: number;
      readonly position: ResizeSample;
      readonly baseRevision: Revision;
    }
  | { readonly type: "POINTER_MOVE"; readonly pointerId: number; readonly position: ResizeSample }
  | { readonly type: "POINTER_END"; readonly pointerId: number }
  | { readonly type: "POINTER_CANCEL"; readonly pointerId: number }
  | { readonly type: "CAPTURE_LOST"; readonly pointerId: number }
  | {
      readonly type: "KEYBOARD_START";
      readonly position: ResizeSample;
      readonly baseRevision: Revision;
    }
  | { readonly type: "KEYBOARD_STEP"; readonly position: ResizeSample }
  | { readonly type: "CONSTRAINT_RESULT"; readonly position: ResizeSample }
  | { readonly type: "COMMIT" }
  | { readonly type: "COMMIT_OK" }
  | { readonly type: "COMMIT_ERROR"; readonly message: string }
  | { readonly type: "SETTLED" }
  | { readonly type: "CANCEL" }
  | { readonly type: "RETURNED" };

function pointerMatches(context: ResizeContext, event: ResizeEvent): boolean {
  return "pointerId" in event && event.pointerId === context.pointerId;
}

export const resizeMachine = setup({
  types: {
    context: {} as ResizeContext,
    events: {} as ResizeEvent,
  },
  guards: {
    pointerMatches: ({ context, event }) => pointerMatches(context, event),
  },
  actions: {
    armPointer: assign(({ event }) =>
      event.type === "POINTER_START"
        ? {
            pointerId: event.pointerId,
            baseRevision: event.baseRevision,
            current: event.position,
            constrained: event.position,
            input: "pointer" as const,
            failure: undefined,
          }
        : {},
    ),
    armKeyboard: assign(({ event }) =>
      event.type === "KEYBOARD_START"
        ? {
            pointerId: undefined,
            baseRevision: event.baseRevision,
            current: event.position,
            constrained: event.position,
            input: "keyboard" as const,
            failure: undefined,
          }
        : {},
    ),
    samplePointer: assign(({ event }) =>
      event.type === "POINTER_MOVE" ? { current: event.position } : {},
    ),
    sampleKeyboard: assign(({ event }) =>
      event.type === "KEYBOARD_STEP" ? { current: event.position } : {},
    ),
    constrain: assign(({ event }) =>
      event.type === "CONSTRAINT_RESULT" ? { constrained: event.position } : {},
    ),
    fail: assign(({ event }) => (event.type === "COMMIT_ERROR" ? { failure: event.message } : {})),
    reset: assign({
      pointerId: undefined,
      baseRevision: undefined,
      current: undefined,
      constrained: undefined,
      input: undefined,
      failure: undefined,
    }),
  },
}).createMachine({
  id: "workspace-resize",
  initial: "idle",
  context: {
    pointerId: undefined,
    baseRevision: undefined,
    current: undefined,
    constrained: undefined,
    input: undefined,
    failure: undefined,
  },
  states: {
    idle: {
      entry: "reset",
      on: {
        POINTER_START: { target: "armed", actions: "armPointer" },
        KEYBOARD_START: { target: "resizing", actions: "armKeyboard" },
      },
    },
    armed: {
      on: {
        POINTER_MOVE: {
          guard: "pointerMatches",
          target: "resizing",
          actions: "samplePointer",
        },
        POINTER_END: { guard: "pointerMatches", target: "idle" },
        POINTER_CANCEL: { guard: "pointerMatches", target: "idle" },
        CAPTURE_LOST: { guard: "pointerMatches", target: "idle" },
        CANCEL: { target: "idle" },
      },
    },
    resizing: {
      on: {
        POINTER_MOVE: { guard: "pointerMatches", actions: "samplePointer" },
        POINTER_END: { guard: "pointerMatches", target: "committing" },
        POINTER_CANCEL: { guard: "pointerMatches", target: "cancelling" },
        CAPTURE_LOST: { guard: "pointerMatches", target: "cancelling" },
        KEYBOARD_STEP: { actions: "sampleKeyboard" },
        CONSTRAINT_RESULT: { actions: "constrain" },
        COMMIT: { target: "committing" },
        CANCEL: { target: "cancelling" },
      },
    },
    committing: {
      on: {
        COMMIT_OK: { target: "settling" },
        COMMIT_ERROR: { target: "cancelling", actions: "fail" },
        CANCEL: { target: "cancelling" },
      },
    },
    settling: {
      on: { SETTLED: { target: "idle" }, CANCEL: { target: "idle" } },
    },
    cancelling: {
      on: { RETURNED: { target: "idle" } },
    },
  },
});

export function createResizeActor() {
  return createActor(resizeMachine);
}
