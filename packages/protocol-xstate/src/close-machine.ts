import { assign, createActor, setup } from "xstate";

export interface CloseProtocolContext {
  readonly requestId: string | undefined;
  readonly dirty: boolean;
  readonly checkpointRequired: boolean;
  readonly checkpointed: boolean;
  readonly undoPreparationRequired: boolean;
  readonly undoPrepared: boolean;
  readonly failure: "denied" | "timed-out" | "cancelled" | "commit-failed" | undefined;
}

export type CloseProtocolEvent =
  | {
      readonly type: "REQUEST";
      readonly requestId: string;
      readonly dirty: boolean;
      readonly checkpointRequired?: boolean;
      readonly undoPreparationRequired?: boolean;
    }
  | { readonly type: "CHECK_GUARD" | "GUARD_ALLOWED" | "CHECKPOINTED" | "UNDO_PREPARED" }
  | { readonly type: "GUARD_DENIED" | "GUARD_TIMEOUT" | "CANCEL" | "COMMIT_FAILED" }
  | { readonly type: "COMMIT" | "VISUAL_FINISHED" };

export const closeMachine = setup({
  types: {
    context: {} as CloseProtocolContext,
    events: {} as CloseProtocolEvent,
  },
  guards: {
    readyToCommit: ({ context }) =>
      (!context.checkpointRequired || context.checkpointed) &&
      (!context.undoPreparationRequired || context.undoPrepared),
  },
  actions: {
    request: assign(({ event }) =>
      event.type === "REQUEST"
        ? {
            requestId: event.requestId,
            dirty: event.dirty,
            checkpointRequired: event.checkpointRequired ?? false,
            checkpointed: false,
            undoPreparationRequired: event.undoPreparationRequired ?? false,
            undoPrepared: false,
            failure: undefined,
          }
        : {},
    ),
    checkpoint: assign({ checkpointed: true }),
    prepareUndo: assign({ undoPrepared: true }),
    fail: assign(({ event }) => {
      switch (event.type) {
        case "GUARD_DENIED":
          return { failure: "denied" as const };
        case "GUARD_TIMEOUT":
          return { failure: "timed-out" as const };
        case "COMMIT_FAILED":
          return { failure: "commit-failed" as const };
        default:
          return { failure: "cancelled" as const };
      }
    }),
  },
}).createMachine({
  id: "panel-close",
  initial: "open",
  context: {
    requestId: undefined,
    dirty: false,
    checkpointRequired: false,
    checkpointed: false,
    undoPreparationRequired: false,
    undoPrepared: false,
    failure: undefined,
  },
  states: {
    open: { on: { REQUEST: { target: "requested", actions: "request" } } },
    requested: {
      on: {
        CHECK_GUARD: { target: "checking-guard" },
        CANCEL: { target: "open", actions: "fail" },
      },
    },
    "checking-guard": {
      on: {
        GUARD_ALLOWED: { target: "committing-close" },
        GUARD_DENIED: { target: "open", actions: "fail" },
        GUARD_TIMEOUT: { target: "open", actions: "fail" },
        CANCEL: { target: "open", actions: "fail" },
      },
    },
    "committing-close": {
      on: {
        CHECKPOINTED: { actions: "checkpoint" },
        UNDO_PREPARED: { actions: "prepareUndo" },
        COMMIT: { guard: "readyToCommit", target: "visual-retirement" },
        COMMIT_FAILED: { target: "open", actions: "fail" },
        CANCEL: { target: "open", actions: "fail" },
      },
    },
    "visual-retirement": {
      on: { VISUAL_FINISHED: { target: "disposed" } },
    },
    disposed: { type: "final" },
  },
});

export function createCloseActor() {
  return createActor(closeMachine);
}
