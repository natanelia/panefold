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

export interface TransferProtocolContext {
  readonly token: string | undefined;
  readonly failureStage: TransferProtocolStage | undefined;
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
    }
  | { readonly type: "CANCEL" }
  | { readonly type: "COMPENSATED" }
  | { readonly type: "COMPENSATION_FAILED" };

export const surfaceTransferMachine = setup({
  types: {
    context: {} as TransferProtocolContext,
    events: {} as TransferProtocolEvent,
  },
  actions: {
    start: assign(({ event }) =>
      event.type === "START"
        ? { token: event.token, failure: undefined, failureStage: undefined }
        : {},
    ),
    fail: assign(({ event }) =>
      event.type === "FAILED"
        ? { failure: event.message, failureStage: event.stage }
        : { failure: "cancelled" },
    ),
  },
}).createMachine({
  id: "surface-transfer",
  initial: "source-owned",
  context: { token: undefined, failureStage: undefined, failure: undefined },
  states: {
    "source-owned": {
      on: { START: { target: "preparing", actions: "start" } },
    },
    preparing: {
      on: {
        PREPARED: { target: "bootstrapping" },
        FAILED: { target: "failed-safe", actions: "fail" },
        CANCEL: { target: "failed-safe", actions: "fail" },
      },
    },
    bootstrapping: {
      on: {
        BOOTSTRAPPED: { target: "checkpointing" },
        FAILED: { target: "failed-safe", actions: "fail" },
        CANCEL: { target: "failed-safe", actions: "fail" },
      },
    },
    checkpointing: {
      on: {
        CHECKPOINTED: { target: "revalidating" },
        FAILED: { target: "failed-safe", actions: "fail" },
        CANCEL: { target: "failed-safe", actions: "fail" },
      },
    },
    revalidating: {
      on: {
        REVALIDATED: { target: "ownership-commit" },
        FAILED: { target: "failed-safe", actions: "fail" },
        CANCEL: { target: "failed-safe", actions: "fail" },
      },
    },
    "ownership-commit": {
      on: {
        OWNERSHIP_COMMITTED: { target: "destination-mount" },
        FAILED: { target: "failed-safe", actions: "fail" },
        CANCEL: { target: "failed-safe", actions: "fail" },
      },
    },
    "destination-mount": {
      on: {
        DESTINATION_MOUNTED: { target: "ready" },
        FAILED: { target: "compensating", actions: "fail" },
        CANCEL: { target: "compensating", actions: "fail" },
      },
    },
    ready: {
      on: {
        DESTINATION_READY: { target: "source-release" },
        FAILED: { target: "compensating", actions: "fail" },
        CANCEL: { target: "compensating", actions: "fail" },
      },
    },
    "source-release": {
      on: {
        SOURCE_RELEASED: { target: "completed" },
        FAILED: { target: "source-release-retry", actions: "fail" },
      },
    },
    "source-release-retry": {
      on: {
        RETRY_SOURCE_RELEASE: { target: "source-release" },
        SOURCE_RELEASED: { target: "completed" },
        FAILED: { actions: "fail" },
      },
    },
    compensating: {
      on: {
        COMPENSATED: { target: "recovered" },
        COMPENSATION_FAILED: { target: "failed-safe" },
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
