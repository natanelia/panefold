import { assign, createActor, setup } from "xstate";

export type TransferProtocolStage =
  | "prepare"
  | "bootstrap"
  | "checkpoint"
  | "revalidate"
  | "ownership-commit"
  | "destination-mount"
  | "destination-ready"
  | "source-release";

export type TransferFailureCause =
  | "popup-blocked"
  | "protocol-mismatch"
  | "destination-closed"
  | "source-crashed"
  | "checkpoint-failed"
  | "revision-conflict"
  | "timed-out"
  | "operation-failed"
  | "cancelled"
  | "compensation-failed";

export interface TransferProtocolContext {
  readonly token: string | undefined;
  readonly failureStage: TransferProtocolStage | undefined;
  readonly failureCause?: TransferFailureCause | undefined;
  readonly failure: string | undefined;
}

export type TransferProtocolEvent =
  | { readonly type: "START"; readonly token: string }
  | { readonly type: "PREPARED" }
  | { readonly type: "BOOTSTRAPPED" }
  | { readonly type: "CHECKPOINTED" }
  | { readonly type: "REVALIDATED" }
  | { readonly type: "OWNERSHIP_COMMITTED" }
  | { readonly type: "DESTINATION_MOUNTED" }
  | { readonly type: "DESTINATION_READY" }
  | { readonly type: "SOURCE_RELEASED" }
  | { readonly type: "RETRY_SOURCE_RELEASE" }
  | {
      readonly type: "FAILED";
      readonly stage: TransferProtocolStage;
      readonly message: string;
      readonly cause?: TransferFailureCause;
    }
  | { readonly type: "CANCEL" }
  | { readonly type: "COMPENSATED" }
  | { readonly type: "COMPENSATION_FAILED" };

export const surfaceTransferMachine = setup({
  types: {
    context: {} as TransferProtocolContext,
    events: {} as TransferProtocolEvent,
  },
  guards: {
    failedAtPrepare: ({ event }) => event.type === "FAILED" && event.stage === "prepare",
    failedAtBootstrap: ({ event }) => event.type === "FAILED" && event.stage === "bootstrap",
    failedAtCheckpoint: ({ event }) => event.type === "FAILED" && event.stage === "checkpoint",
    failedAtRevalidate: ({ event }) => event.type === "FAILED" && event.stage === "revalidate",
    failedAtOwnershipCommit: ({ event }) =>
      event.type === "FAILED" && event.stage === "ownership-commit",
    failedAtDestinationMount: ({ event }) =>
      event.type === "FAILED" && event.stage === "destination-mount",
    failedAtDestinationReady: ({ event }) =>
      event.type === "FAILED" && event.stage === "destination-ready",
    failedAtSourceRelease: ({ event }) =>
      event.type === "FAILED" && event.stage === "source-release",
  },
  actions: {
    start: assign(({ event }) =>
      event.type === "START"
        ? {
            token: event.token,
            failure: undefined,
            failureStage: undefined,
            failureCause: undefined,
          }
        : {},
    ),
    fail: assign(({ event }) =>
      event.type === "FAILED"
        ? {
            failure: event.message,
            failureStage: event.stage,
            failureCause: event.cause ?? ("operation-failed" as const),
          }
        : { failure: "cancelled", failureCause: "cancelled" as const },
    ),
    failCompensation: assign(({ context }) => ({
      failure: context.failure ?? "compensation-failed",
      failureCause: "compensation-failed" as const,
    })),
  },
}).createMachine({
  id: "surface-transfer",
  initial: "source-owned",
  context: {
    token: undefined,
    failureStage: undefined,
    failureCause: undefined,
    failure: undefined,
  },
  states: {
    "source-owned": {
      on: { START: { target: "preparing", actions: "start" } },
    },
    preparing: {
      on: {
        PREPARED: { target: "bootstrapping" },
        FAILED: { guard: "failedAtPrepare", target: "failed-safe", actions: "fail" },
        CANCEL: { target: "failed-safe", actions: "fail" },
      },
    },
    bootstrapping: {
      on: {
        BOOTSTRAPPED: { target: "checkpointing" },
        FAILED: { guard: "failedAtBootstrap", target: "failed-safe", actions: "fail" },
        CANCEL: { target: "failed-safe", actions: "fail" },
      },
    },
    checkpointing: {
      on: {
        CHECKPOINTED: { target: "revalidating" },
        FAILED: { guard: "failedAtCheckpoint", target: "failed-safe", actions: "fail" },
        CANCEL: { target: "failed-safe", actions: "fail" },
      },
    },
    revalidating: {
      on: {
        REVALIDATED: { target: "ownership-commit" },
        FAILED: { guard: "failedAtRevalidate", target: "failed-safe", actions: "fail" },
        CANCEL: { target: "failed-safe", actions: "fail" },
      },
    },
    "ownership-commit": {
      on: {
        OWNERSHIP_COMMITTED: { target: "destination-mount" },
        FAILED: { guard: "failedAtOwnershipCommit", target: "failed-safe", actions: "fail" },
        CANCEL: { target: "failed-safe", actions: "fail" },
      },
    },
    "destination-mount": {
      on: {
        DESTINATION_MOUNTED: { target: "ready" },
        FAILED: { guard: "failedAtDestinationMount", target: "compensating", actions: "fail" },
        CANCEL: { target: "compensating", actions: "fail" },
      },
    },
    ready: {
      on: {
        DESTINATION_READY: { target: "source-release" },
        FAILED: { guard: "failedAtDestinationReady", target: "compensating", actions: "fail" },
        CANCEL: { target: "compensating", actions: "fail" },
      },
    },
    "source-release": {
      on: {
        SOURCE_RELEASED: { target: "completed" },
        FAILED: {
          guard: "failedAtSourceRelease",
          target: "source-release-retry",
          actions: "fail",
        },
      },
    },
    "source-release-retry": {
      on: {
        RETRY_SOURCE_RELEASE: { target: "source-release" },
        SOURCE_RELEASED: { target: "completed" },
        FAILED: { guard: "failedAtSourceRelease", actions: "fail" },
      },
    },
    compensating: {
      on: {
        COMPENSATED: { target: "recovered" },
        COMPENSATION_FAILED: { target: "failed-safe", actions: "failCompensation" },
      },
    },
    completed: { type: "final" },
    recovered: { type: "final" },
    "failed-safe": { type: "final" },
  },
});

export function createSurfaceTransferActor() {
  return createActor(surfaceTransferMachine);
}
