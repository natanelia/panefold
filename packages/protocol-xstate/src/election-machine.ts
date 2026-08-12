import { assign, createActor, setup } from "xstate";

export interface ElectionInput {
  readonly epoch?: number;
}

export interface ElectionContext {
  readonly epoch: number;
  readonly proposedEpoch: number | undefined;
}

export type ElectionEvent =
  | { readonly type: "HEARTBEAT"; readonly epoch: number }
  | { readonly type: "TIMEOUT" }
  | { readonly type: "PROPOSE"; readonly epoch: number }
  | { readonly type: "WON"; readonly epoch: number }
  | { readonly type: "HIGHER_EPOCH"; readonly epoch: number }
  | { readonly type: "STEP_DOWN" }
  | { readonly type: "STOP" };

export const coordinatorElectionMachine = setup({
  types: {
    context: {} as ElectionContext,
    events: {} as ElectionEvent,
    input: {} as ElectionInput,
  },
  guards: {
    isCurrentOrNewer: ({ context, event }) =>
      "epoch" in event && Number.isSafeInteger(event.epoch) && event.epoch >= context.epoch,
    isNewer: ({ context, event }) =>
      "epoch" in event && Number.isSafeInteger(event.epoch) && event.epoch > context.epoch,
    wonProposal: ({ context, event }) =>
      event.type === "WON" && event.epoch === context.proposedEpoch,
  },
  actions: {
    acceptEpoch: assign(({ context, event }) =>
      "epoch" in event && event.epoch >= context.epoch
        ? { epoch: event.epoch, proposedEpoch: undefined }
        : {},
    ),
    propose: assign(({ event }) =>
      event.type === "PROPOSE" ? { proposedEpoch: event.epoch } : {},
    ),
    clearProposal: assign({ proposedEpoch: undefined }),
  },
}).createMachine({
  id: "coordinator-election",
  initial: "follower",
  context: ({ input }) => {
    const epoch = input.epoch ?? 0;
    if (!Number.isSafeInteger(epoch) || epoch < 0) {
      throw new RangeError("epoch must be a non-negative safe integer");
    }
    return { epoch, proposedEpoch: undefined };
  },
  states: {
    follower: {
      on: {
        HEARTBEAT: { guard: "isCurrentOrNewer", actions: "acceptEpoch" },
        TIMEOUT: { target: "candidate" },
        HIGHER_EPOCH: { guard: "isCurrentOrNewer", actions: "acceptEpoch" },
        STOP: { target: "stale" },
      },
    },
    candidate: {
      on: {
        PROPOSE: { guard: "isNewer", actions: "propose" },
        WON: { guard: "wonProposal", target: "leader", actions: "acceptEpoch" },
        HEARTBEAT: { guard: "isCurrentOrNewer", target: "follower", actions: "acceptEpoch" },
        HIGHER_EPOCH: { guard: "isCurrentOrNewer", target: "follower", actions: "acceptEpoch" },
        STOP: { target: "stale" },
      },
    },
    leader: {
      on: {
        HIGHER_EPOCH: {
          guard: "isNewer",
          target: "stepping-down",
          actions: "acceptEpoch",
        },
        STEP_DOWN: { target: "stepping-down" },
        STOP: { target: "stale" },
      },
    },
    "stepping-down": {
      always: { target: "follower", actions: "clearProposal" },
    },
    stale: { type: "final" },
  },
});

export function createCoordinatorElectionActor(input: ElectionInput = {}) {
  return createActor(coordinatorElectionMachine, { input });
}
