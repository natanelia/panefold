import { assign, createActor, setup } from "xstate";

export type SuspendReason = "visibility" | "budget" | "application";

export interface SuspendResumeContext {
  readonly reason: SuspendReason | undefined;
  readonly checkpointRequired: boolean;
  readonly failedOperation: "suspend" | "resume" | undefined;
  readonly failure: string | undefined;
}

export type SuspendResumeEvent =
  | {
      readonly type: "REQUEST_SUSPEND";
      readonly reason: SuspendReason;
      readonly checkpointRequired: boolean;
    }
  | { readonly type: "BEGIN_CHECKPOINT" | "SUSPEND_READY" | "CHECKPOINTED" }
  | { readonly type: "CHECKPOINT_FAILED" | "RESUME_FAILED"; readonly message: string }
  | { readonly type: "REQUEST_RESUME" | "RESUMED" | "CANCEL" }
  | { readonly type: "RETRY_SUSPEND" | "RETRY_RESUME" };

export const suspendResumeMachine = setup({
  types: {
    context: {} as SuspendResumeContext,
    events: {} as SuspendResumeEvent,
  },
  guards: {
    needsCheckpoint: ({ context }) => context.checkpointRequired,
    canSuspendDirectly: ({ context }) => !context.checkpointRequired,
    failedWhileResuming: ({ context }) => context.failedOperation === "resume",
  },
  actions: {
    request: assign(({ event }) =>
      event.type === "REQUEST_SUSPEND"
        ? {
            reason: event.reason,
            checkpointRequired: event.checkpointRequired,
            failedOperation: undefined,
            failure: undefined,
          }
        : {},
    ),
    failSuspend: assign(({ event }) =>
      event.type === "CHECKPOINT_FAILED"
        ? { failedOperation: "suspend" as const, failure: event.message }
        : {},
    ),
    failResume: assign(({ event }) =>
      event.type === "RESUME_FAILED"
        ? { failedOperation: "resume" as const, failure: event.message }
        : {},
    ),
    clearFailure: assign({ failedOperation: undefined, failure: undefined }),
  },
}).createMachine({
  id: "suspend-resume",
  initial: "mounted",
  context: {
    reason: undefined,
    checkpointRequired: false,
    failedOperation: undefined,
    failure: undefined,
  },
  states: {
    mounted: {
      on: { REQUEST_SUSPEND: { target: "suspend-requested", actions: "request" } },
    },
    "suspend-requested": {
      on: {
        BEGIN_CHECKPOINT: { guard: "needsCheckpoint", target: "checkpointing" },
        SUSPEND_READY: { guard: "canSuspendDirectly", target: "suspended" },
        CANCEL: { target: "mounted" },
      },
    },
    checkpointing: {
      on: {
        CHECKPOINTED: { target: "suspended" },
        CHECKPOINT_FAILED: { target: "failed", actions: "failSuspend" },
        CANCEL: { target: "mounted" },
      },
    },
    suspended: {
      on: { REQUEST_RESUME: { target: "resuming", actions: "clearFailure" } },
    },
    resuming: {
      on: {
        RESUMED: { target: "mounted", actions: "clearFailure" },
        RESUME_FAILED: { target: "failed", actions: "failResume" },
        CANCEL: { target: "suspended" },
      },
    },
    failed: {
      on: {
        RETRY_SUSPEND: { target: "suspend-requested", actions: "clearFailure" },
        RETRY_RESUME: { guard: "failedWhileResuming", target: "resuming", actions: "clearFailure" },
        CANCEL: [{ guard: "failedWhileResuming", target: "suspended" }, { target: "mounted" }],
      },
    },
  },
});

export function createSuspendResumeActor() {
  return createActor(suspendResumeMachine);
}
