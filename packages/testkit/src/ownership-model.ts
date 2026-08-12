export type OwnershipLocation = "source" | "destination" | "safe-main";
export type OwnershipPhase = "idle" | "prepared" | "committed";

export interface OwnershipModelState {
  readonly owner: OwnershipLocation;
  readonly phase: OwnershipPhase;
  readonly coordinatorEpoch: number;
  readonly destinationPrepared: boolean;
}

export type OwnershipModelEvent =
  | { readonly type: "prepare" }
  | { readonly type: "commit"; readonly epoch: number }
  | { readonly type: "cancel" }
  | { readonly type: "coordinator-loss" }
  | { readonly type: "source-loss" }
  | { readonly type: "destination-loss" }
  | { readonly type: "duplicate-commit"; readonly epoch: number };

export interface OwnershipModelReport {
  readonly depth: number;
  readonly states: number;
  readonly transitions: number;
  readonly violations: readonly string[];
}

const EVENTS: readonly OwnershipModelEvent[] = Object.freeze([
  { type: "prepare" },
  { type: "commit", epoch: 0 },
  { type: "commit", epoch: 1 },
  { type: "cancel" },
  { type: "coordinator-loss" },
  { type: "source-loss" },
  { type: "destination-loss" },
  { type: "duplicate-commit", epoch: 0 },
  { type: "duplicate-commit", epoch: 1 },
]);

/** Exhaustively explores duplicate, stale, reordered, cancelled, and loss events. */
export function checkPreparedTransferOwnership(depth = 8): OwnershipModelReport {
  if (!Number.isSafeInteger(depth) || depth < 0 || depth > 12) {
    throw new RangeError("Ownership exploration depth must be an integer from 0 to 12");
  }
  const initial: OwnershipModelState = {
    owner: "source",
    phase: "idle",
    coordinatorEpoch: 0,
    destinationPrepared: false,
  };
  let frontier = new Map([[keyOf(initial), initial]]);
  const visited = new Map(frontier);
  const violations: string[] = [];
  let transitions = 0;

  for (let step = 0; step < depth; step += 1) {
    const nextFrontier = new Map<string, OwnershipModelState>();
    for (const state of frontier.values()) {
      for (const event of EVENTS) {
        transitions += 1;
        const next = applyOwnershipEvent(state, event);
        if (!isValidOwnershipState(next))
          violations.push(`${keyOf(state)} -> ${event.type} -> ${keyOf(next)}`);
        const key = keyOf(next);
        if (!visited.has(key)) {
          visited.set(key, next);
          nextFrontier.set(key, next);
        }
      }
    }
    frontier = nextFrontier;
    if (frontier.size === 0) break;
  }

  return Object.freeze({
    depth,
    states: visited.size,
    transitions,
    violations: Object.freeze(violations),
  });
}

export function applyOwnershipEvent(
  state: OwnershipModelState,
  event: OwnershipModelEvent,
): OwnershipModelState {
  switch (event.type) {
    case "prepare":
      return state.owner === "source"
        ? frozen({ ...state, phase: "prepared", destinationPrepared: true })
        : state;
    case "commit":
    case "duplicate-commit":
      return state.owner === "source" &&
        state.destinationPrepared &&
        event.epoch === state.coordinatorEpoch
        ? frozen({ ...state, owner: "destination", phase: "committed" })
        : state;
    case "cancel":
      return state.phase === "committed"
        ? state
        : frozen({ ...state, phase: "idle", destinationPrepared: false });
    case "coordinator-loss":
      return frozen({
        ...state,
        coordinatorEpoch: state.coordinatorEpoch + 1,
        phase: state.owner === "destination" ? "committed" : "idle",
        destinationPrepared: state.owner === "destination",
      });
    case "source-loss":
      return state.owner === "source"
        ? frozen({ ...state, owner: "safe-main", phase: "idle", destinationPrepared: false })
        : state;
    case "destination-loss":
      return state.owner === "destination"
        ? frozen({ ...state, owner: "safe-main", phase: "idle", destinationPrepared: false })
        : frozen({ ...state, phase: "idle", destinationPrepared: false });
  }
}

function isValidOwnershipState(state: OwnershipModelState): boolean {
  if (!Number.isSafeInteger(state.coordinatorEpoch) || state.coordinatorEpoch < 0) return false;
  if (state.phase === "prepared" && (!state.destinationPrepared || state.owner !== "source"))
    return false;
  if (state.phase === "committed" && state.owner !== "destination") return false;
  return true;
}

function keyOf(state: OwnershipModelState): string {
  return `${state.owner}|${state.phase}|${String(state.coordinatorEpoch)}|${String(state.destinationPrepared)}`;
}

function frozen(state: OwnershipModelState): OwnershipModelState {
  return Object.freeze(state);
}
