import type { Revision } from "@panefold/model";
import { assign, createActor, setup } from "xstate";

export type KeyboardTargetClass = "tab" | "group" | "region" | "surface";

export interface KeyboardMoveTarget {
  readonly id: string;
  readonly label: string;
  readonly targetClass: KeyboardTargetClass;
}

export interface KeyboardMoveContext {
  readonly baseRevision: Revision | undefined;
  readonly target: KeyboardMoveTarget | undefined;
  readonly announcement: string | undefined;
  readonly failure: string | undefined;
}

export type KeyboardMoveEvent =
  | {
      readonly type: "START";
      readonly baseRevision: Revision;
      readonly target: KeyboardMoveTarget;
    }
  | { readonly type: "NAVIGATE" | "CYCLE_TARGET_CLASS"; readonly target: KeyboardMoveTarget }
  | { readonly type: "TARGET_INVALIDATED"; readonly fallback?: KeyboardMoveTarget }
  | { readonly type: "COMMIT" | "ANNOUNCED" | "CANCEL" | "RESET" }
  | { readonly type: "COMMIT_OK"; readonly announcement: string }
  | { readonly type: "REVISION_CONFLICT" }
  | { readonly type: "COMMIT_ERROR"; readonly message: string };

export const keyboardMoveMachine = setup({
  types: {
    context: {} as KeyboardMoveContext,
    events: {} as KeyboardMoveEvent,
  },
  guards: {
    hasFallback: ({ event }) => event.type === "TARGET_INVALIDATED" && event.fallback !== undefined,
  },
  actions: {
    begin: assign(({ event }) =>
      event.type === "START"
        ? {
            baseRevision: event.baseRevision,
            target: event.target,
            announcement: undefined,
            failure: undefined,
          }
        : {},
    ),
    choose: assign(({ event }) => {
      if (event.type === "NAVIGATE" || event.type === "CYCLE_TARGET_CLASS") {
        return { target: event.target };
      }
      if (event.type === "TARGET_INVALIDATED") return { target: event.fallback };
      return {};
    }),
    announce: assign(({ event }) =>
      event.type === "COMMIT_OK" ? { announcement: event.announcement } : {},
    ),
    fail: assign(({ event }) =>
      event.type === "COMMIT_ERROR"
        ? { failure: event.message }
        : event.type === "REVISION_CONFLICT"
          ? { failure: "revision-conflict", target: undefined }
          : { failure: "cancelled", target: undefined },
    ),
    reset: assign({
      baseRevision: undefined,
      target: undefined,
      announcement: undefined,
      failure: undefined,
    }),
  },
}).createMachine({
  id: "keyboard-move",
  initial: "idle",
  context: {
    baseRevision: undefined,
    target: undefined,
    announcement: undefined,
    failure: undefined,
  },
  states: {
    idle: {
      entry: "reset",
      on: { START: { target: "choosing-target", actions: "begin" } },
    },
    "choosing-target": {
      on: {
        NAVIGATE: { actions: "choose" },
        CYCLE_TARGET_CLASS: { actions: "choose" },
        TARGET_INVALIDATED: [
          { guard: "hasFallback", actions: "choose" },
          { target: "cancelled", actions: "fail" },
        ],
        COMMIT: { target: "committing" },
        CANCEL: { target: "cancelled", actions: "fail" },
      },
    },
    committing: {
      on: {
        COMMIT_OK: { target: "announcing", actions: "announce" },
        COMMIT_ERROR: { target: "cancelled", actions: "fail" },
        REVISION_CONFLICT: { target: "cancelled", actions: "fail" },
        CANCEL: { target: "cancelled", actions: "fail" },
      },
    },
    announcing: {
      on: { ANNOUNCED: { target: "idle" }, CANCEL: { target: "idle" } },
    },
    cancelled: {
      on: {
        RESET: { target: "idle" },
        START: { target: "choosing-target", actions: "begin" },
      },
    },
  },
});

export function createKeyboardMoveActor() {
  return createActor(keyboardMoveMachine);
}
