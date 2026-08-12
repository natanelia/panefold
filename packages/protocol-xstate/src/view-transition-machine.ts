import { assign, createActor, setup } from "xstate";

export type ViewTransitionSkipReason =
  | "explicit-skip"
  | "interrupted"
  | "unsupported"
  | "duplicate-name"
  | "budget-rejected"
  | "capture-failed";

export interface ViewTransitionContext {
  readonly commitApplied: boolean;
  readonly skipReason: ViewTransitionSkipReason | undefined;
}

export type ViewTransitionEvent =
  | { readonly type: "START" | "OLD_CAPTURED" | "COMMITTED" | "NEW_CAPTURED" | "FINISHED" }
  | { readonly type: "SKIP"; readonly reason?: string }
  | {
      readonly type:
        | "HIGHER_PRIORITY_COMMAND"
        | "UNSUPPORTED"
        | "DUPLICATE_NAME"
        | "BUDGET_REJECTED"
        | "CAPTURE_FAILED";
    }
  | { readonly type: "FALLBACK_COMMITTED" | "COMPLETE_SKIP" };

export const viewTransitionMachine = setup({
  types: {
    context: {} as ViewTransitionContext,
    events: {} as ViewTransitionEvent,
  },
  guards: {
    commitApplied: ({ context }) => context.commitApplied,
  },
  actions: {
    markCommitted: assign({ commitApplied: true }),
    skip: assign(({ event }) => {
      let skipReason: ViewTransitionSkipReason = "explicit-skip";
      if (event.type === "HIGHER_PRIORITY_COMMAND") skipReason = "interrupted";
      if (event.type === "UNSUPPORTED") skipReason = "unsupported";
      if (event.type === "DUPLICATE_NAME") skipReason = "duplicate-name";
      if (event.type === "BUDGET_REJECTED") skipReason = "budget-rejected";
      if (event.type === "CAPTURE_FAILED") skipReason = "capture-failed";
      return { skipReason };
    }),
  },
}).createMachine({
  id: "view-transition",
  initial: "eligible",
  context: { commitApplied: false, skipReason: undefined },
  states: {
    eligible: {
      on: {
        START: { target: "capturing-old" },
        SKIP: { target: "skipped", actions: "skip" },
        UNSUPPORTED: { target: "skipped", actions: "skip" },
        BUDGET_REJECTED: { target: "skipped", actions: "skip" },
        HIGHER_PRIORITY_COMMAND: { target: "skipped", actions: "skip" },
      },
    },
    "capturing-old": {
      on: {
        OLD_CAPTURED: { target: "committing" },
        CAPTURE_FAILED: { target: "skipped", actions: "skip" },
        DUPLICATE_NAME: { target: "skipped", actions: "skip" },
        SKIP: { target: "skipped", actions: "skip" },
        HIGHER_PRIORITY_COMMAND: { target: "skipped", actions: "skip" },
      },
    },
    committing: {
      on: {
        COMMITTED: { target: "capturing-new", actions: "markCommitted" },
        CAPTURE_FAILED: { target: "skipped", actions: "skip" },
        SKIP: { target: "skipped", actions: "skip" },
        HIGHER_PRIORITY_COMMAND: { target: "skipped", actions: "skip" },
      },
    },
    "capturing-new": {
      on: {
        NEW_CAPTURED: { target: "animating" },
        CAPTURE_FAILED: { target: "skipped", actions: "skip" },
        DUPLICATE_NAME: { target: "skipped", actions: "skip" },
        SKIP: { target: "skipped", actions: "skip" },
        HIGHER_PRIORITY_COMMAND: { target: "skipped", actions: "skip" },
      },
    },
    animating: {
      on: {
        FINISHED: { target: "completed" },
        SKIP: { target: "skipped", actions: "skip" },
        HIGHER_PRIORITY_COMMAND: { target: "skipped", actions: "skip" },
      },
    },
    skipped: {
      on: {
        FALLBACK_COMMITTED: { target: "completed", actions: "markCommitted" },
        COMPLETE_SKIP: { guard: "commitApplied", target: "completed" },
      },
    },
    completed: { type: "final" },
  },
});

export function createViewTransitionActor() {
  return createActor(viewTransitionMachine);
}
