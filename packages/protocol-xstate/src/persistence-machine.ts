import { assign, createActor, setup } from "xstate";

export interface PersistenceWorkerInput {
  readonly queueLimit?: number;
}

export interface PersistenceWorkerContext {
  readonly queueLimit: number;
  readonly queueDepth: number;
  readonly failure: string | undefined;
}

export type PersistenceWorkerEvent =
  | { readonly type: "ENQUEUE" }
  | { readonly type: "FLUSH" }
  | { readonly type: "JOURNAL_WRITTEN" }
  | { readonly type: "SNAPSHOT_DUE" }
  | { readonly type: "SNAPSHOT_WRITTEN" }
  | { readonly type: "COMPACT" }
  | { readonly type: "COMPACTED" }
  | { readonly type: "STORAGE_ERROR"; readonly message: string }
  | { readonly type: "RETRY" }
  | { readonly type: "RECOVERED" }
  | { readonly type: "STOP" };

export const persistenceWorkerMachine = setup({
  types: {
    context: {} as PersistenceWorkerContext,
    events: {} as PersistenceWorkerEvent,
    input: {} as PersistenceWorkerInput,
  },
  guards: {
    atCapacity: ({ context }) => context.queueDepth >= context.queueLimit,
    hasPending: ({ context }) => context.queueDepth > 0,
  },
  actions: {
    enqueue: assign(({ context }) => ({ queueDepth: context.queueDepth + 1 })),
    clearQueue: assign({ queueDepth: 0 }),
    fail: assign(({ event }) => (event.type === "STORAGE_ERROR" ? { failure: event.message } : {})),
    clearFailure: assign({ failure: undefined }),
  },
}).createMachine({
  id: "persistence-worker",
  initial: "idle",
  context: ({ input }) => {
    const queueLimit = input.queueLimit ?? 1_000;
    if (!Number.isSafeInteger(queueLimit) || queueLimit < 0) {
      throw new RangeError("queueLimit must be a non-negative safe integer");
    }
    return { queueLimit, queueDepth: 0, failure: undefined };
  },
  states: {
    idle: {
      on: {
        ENQUEUE: [
          { guard: "atCapacity", target: "degraded" },
          { target: "batching", actions: "enqueue" },
        ],
        STOP: { target: "stopped" },
      },
    },
    batching: {
      on: {
        ENQUEUE: [{ guard: "atCapacity", target: "degraded" }, { actions: "enqueue" }],
        FLUSH: { guard: "hasPending", target: "writing-journal" },
        STORAGE_ERROR: { target: "degraded", actions: "fail" },
        STOP: { target: "stopped" },
      },
    },
    "writing-journal": {
      on: {
        JOURNAL_WRITTEN: { target: "idle", actions: "clearQueue" },
        SNAPSHOT_DUE: { target: "checkpointing" },
        STORAGE_ERROR: { target: "degraded", actions: "fail" },
      },
    },
    checkpointing: {
      on: {
        SNAPSHOT_WRITTEN: { target: "idle", actions: "clearQueue" },
        COMPACT: { target: "compacting" },
        STORAGE_ERROR: { target: "degraded", actions: "fail" },
      },
    },
    compacting: {
      on: {
        COMPACTED: { target: "idle", actions: "clearQueue" },
        STORAGE_ERROR: { target: "degraded", actions: "fail" },
      },
    },
    degraded: {
      on: { RETRY: { target: "recovering" }, STOP: { target: "stopped" } },
    },
    recovering: {
      on: {
        RECOVERED: { target: "idle", actions: ["clearFailure", "clearQueue"] },
        STORAGE_ERROR: { target: "degraded", actions: "fail" },
      },
    },
    stopped: { type: "final" },
  },
});

export function createPersistenceWorkerActor(input: PersistenceWorkerInput = {}) {
  return createActor(persistenceWorkerMachine, { input });
}
