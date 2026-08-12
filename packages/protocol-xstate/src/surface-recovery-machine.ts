import { assign, createActor, setup } from "xstate";

export interface SurfaceRecoveryContext {
  readonly coordinatorEpoch: number;
  readonly ownershipProof: string | undefined;
  readonly fallbackPlacement: string | undefined;
  readonly failure: string | undefined;
}

export type SurfaceRecoveryEvent =
  | { readonly type: "HEARTBEAT_LATE" | "HEARTBEAT_RECEIVED" | "DISCONNECTED" }
  | { readonly type: "EPOCH_CHANGED"; readonly epoch: number }
  | { readonly type: "ORPHAN_CONFIRMED" }
  | { readonly type: "BEGIN_RESOLUTION"; readonly ownershipProof?: string }
  | { readonly type: "OWNER_RECOVERED"; readonly ownershipProof: string }
  | { readonly type: "FALLBACK_PLACED"; readonly placement: string }
  | { readonly type: "RESOLUTION_FAILED"; readonly message: string }
  | { readonly type: "RESET" };

export interface SurfaceRecoveryInput {
  readonly coordinatorEpoch?: number;
}

export const surfaceRecoveryMachine = setup({
  types: {
    context: {} as SurfaceRecoveryContext,
    events: {} as SurfaceRecoveryEvent,
    input: {} as SurfaceRecoveryInput,
  },
  guards: {
    newerEpoch: ({ context, event }) =>
      event.type === "EPOCH_CHANGED" &&
      Number.isSafeInteger(event.epoch) &&
      event.epoch > context.coordinatorEpoch,
    hasOwnershipProof: ({ event }) =>
      event.type === "OWNER_RECOVERED" && event.ownershipProof.length > 0,
    hasFallback: ({ event }) => event.type === "FALLBACK_PLACED" && event.placement.length > 0,
  },
  actions: {
    acceptEpoch: assign(({ event }) =>
      event.type === "EPOCH_CHANGED" ? { coordinatorEpoch: event.epoch } : {},
    ),
    beginResolution: assign(({ event }) =>
      event.type === "BEGIN_RESOLUTION"
        ? { ownershipProof: event.ownershipProof, fallbackPlacement: undefined, failure: undefined }
        : {},
    ),
    recoverOwner: assign(({ event }) =>
      event.type === "OWNER_RECOVERED" ? { ownershipProof: event.ownershipProof } : {},
    ),
    placeFallback: assign(({ event }) =>
      event.type === "FALLBACK_PLACED" ? { fallbackPlacement: event.placement } : {},
    ),
    fail: assign(({ event }) =>
      event.type === "RESOLUTION_FAILED" ? { failure: event.message } : {},
    ),
    clear: assign({ ownershipProof: undefined, fallbackPlacement: undefined, failure: undefined }),
  },
}).createMachine({
  id: "surface-recovery",
  initial: "healthy",
  context: ({ input }) => {
    const coordinatorEpoch = input.coordinatorEpoch ?? 0;
    if (!Number.isSafeInteger(coordinatorEpoch) || coordinatorEpoch < 0) {
      throw new RangeError("coordinatorEpoch must be a non-negative safe integer");
    }
    return {
      coordinatorEpoch,
      ownershipProof: undefined,
      fallbackPlacement: undefined,
      failure: undefined,
    };
  },
  states: {
    healthy: {
      on: {
        HEARTBEAT_LATE: { target: "heartbeat-late" },
        DISCONNECTED: { target: "disconnected" },
        EPOCH_CHANGED: { guard: "newerEpoch", target: "orphaned", actions: "acceptEpoch" },
      },
    },
    "heartbeat-late": {
      on: {
        HEARTBEAT_RECEIVED: { target: "healthy" },
        DISCONNECTED: { target: "disconnected" },
        EPOCH_CHANGED: { guard: "newerEpoch", target: "orphaned", actions: "acceptEpoch" },
      },
    },
    disconnected: {
      on: {
        HEARTBEAT_RECEIVED: { target: "healthy" },
        ORPHAN_CONFIRMED: { target: "orphaned" },
        EPOCH_CHANGED: { guard: "newerEpoch", target: "orphaned", actions: "acceptEpoch" },
      },
    },
    orphaned: {
      on: {
        BEGIN_RESOLUTION: { target: "resolving", actions: "beginResolution" },
        EPOCH_CHANGED: { guard: "newerEpoch", actions: "acceptEpoch" },
      },
    },
    resolving: {
      on: {
        OWNER_RECOVERED: {
          guard: "hasOwnershipProof",
          target: "recovered",
          actions: "recoverOwner",
        },
        FALLBACK_PLACED: { guard: "hasFallback", target: "recovered", actions: "placeFallback" },
        RESOLUTION_FAILED: { target: "failed-safe", actions: "fail" },
        EPOCH_CHANGED: { guard: "newerEpoch", target: "orphaned", actions: "acceptEpoch" },
      },
    },
    recovered: { on: { RESET: { target: "healthy", actions: "clear" } } },
    "failed-safe": { on: { RESET: { target: "healthy", actions: "clear" } } },
  },
});

export function createSurfaceRecoveryActor(input: SurfaceRecoveryInput = {}) {
  return createActor(surfaceRecoveryMachine, { input });
}
