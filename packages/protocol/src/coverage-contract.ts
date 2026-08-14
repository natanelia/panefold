import type { WorkspaceProtocolKind } from "./types";

export type ProtocolCoverageObligationKind =
  "adversarial" | "interruption" | "timeout" | "recovery" | "finalizer" | "impossible-event";

export interface ProtocolCoverageObligation {
  readonly id: string;
  readonly kind: ProtocolCoverageObligationKind;
  /** Stable witness ID executed by the independent coverage runner. */
  readonly witness: string;
}

export interface ProtocolCoverageTimeoutScenario {
  /** Stable phase identifier, unique within one protocol actor. */
  readonly id: string;
  readonly sourceState: string;
  /** Ordered witness IDs used to reach `sourceState` from the initial state. */
  readonly setupWitnesses: readonly string[];
  /** Witness ID for the event delivered by the production deadline boundary. */
  readonly eventWitness: string;
  readonly expectedState: string;
}

export interface ProtocolCoverageContractEntry {
  readonly kind: WorkspaceProtocolKind;
  readonly states: readonly string[];
  /** SHA-256 of canonical `from|event|branch|to|guard` rows in source order. */
  readonly graphDigest: string;
  readonly transitionCount: number;
  readonly guardedTransitionCount: number;
  readonly timeoutScenarios: readonly ProtocolCoverageTimeoutScenario[];
  readonly obligations: readonly ProtocolCoverageObligation[];
}

interface ProtocolCoverageContractEntryInput extends Omit<
  ProtocolCoverageContractEntry,
  "obligations"
> {
  readonly adversarial: Readonly<Record<string, string>>;
  readonly interruption: string;
  readonly recovery: string;
}

function entry(input: ProtocolCoverageContractEntryInput): ProtocolCoverageContractEntry {
  const { adversarial, interruption, recovery, ...contract } = input;
  const timeoutIds = contract.timeoutScenarios.map((scenario) => scenario.id);
  if (new Set(timeoutIds).size !== timeoutIds.length) {
    throw new Error(`${contract.kind} has duplicate timeout scenario IDs`);
  }
  for (const scenario of contract.timeoutScenarios) {
    if (!contract.states.includes(scenario.sourceState)) {
      throw new Error(`${contract.kind}:${scenario.id} has an unknown timeout source state`);
    }
    if (!contract.states.includes(scenario.expectedState)) {
      throw new Error(`${contract.kind}:${scenario.id} has an unknown timeout expected state`);
    }
  }
  const frozenTimeoutScenarios = Object.freeze(
    contract.timeoutScenarios.map((scenario) =>
      Object.freeze({
        ...scenario,
        setupWitnesses: Object.freeze([...scenario.setupWitnesses]),
      }),
    ),
  );
  return Object.freeze({
    ...contract,
    states: Object.freeze([...contract.states]),
    timeoutScenarios: frozenTimeoutScenarios,
    obligations: Object.freeze(
      obligations(adversarial, interruption, recovery, frozenTimeoutScenarios).map((obligation) =>
        Object.freeze(obligation),
      ),
    ),
  });
}

function obligations(
  adversarial: Readonly<Record<string, string>>,
  interruption: string,
  recovery: string,
  timeoutScenarios: readonly ProtocolCoverageTimeoutScenario[],
): readonly ProtocolCoverageObligation[] {
  return [
    ...Object.entries(adversarial).map(([id, witness]) => ({
      id,
      kind: "adversarial" as const,
      witness,
    })),
    { id: "interruption", kind: "interruption", witness: interruption },
    ...timeoutScenarios.map((scenario) => ({
      id: `deadline:${scenario.id}`,
      kind: "timeout" as const,
      witness: `deadline:${scenario.id}`,
    })),
    { id: "recovery", kind: "recovery", witness: recovery },
    { id: "scope-finalizer", kind: "finalizer", witness: "scope:aborted" },
    {
      id: "impossible-event",
      kind: "impossible-event",
      witness: "impossible:event-ignored",
    },
  ];
}

/**
 * Independent, reviewed graph contract for the twelve Appendix-C protocol
 * actors. The XState adapter must match these states and the canonical graph
 * digest exactly before transition execution can count as TST-003 evidence.
 */
export const PROTOCOL_COVERAGE_CONTRACT = Object.freeze({
  drag: entry({
    kind: "drag",
    states: ["idle", "armed", "dragging", "committing", "settling", "cancelling", "recovering"],
    graphDigest: "3d95795f4909389db5e2b5c8147cbc2483557912df6322af609d06bc61aab7e1",
    transitionCount: 24,
    guardedTransitionCount: 10,
    adversarial: {
      threshold: "drag:pointer-move-threshold",
      "valid-target": "drag:set-candidate",
      "pointer-up": "drag:pointer-up",
      cancel: "drag:cancel",
      "capture-loss": "drag:capture-lost",
      "revision-conflict": "drag:revision-conflict",
      "re-grab": "drag:regrab",
    },
    interruption: "drag:pointer-cancel",
    recovery: "drag:recovered",
    timeoutScenarios: [
      {
        id: "armed",
        sourceState: "armed",
        setupWitnesses: ["drag:pointer-down"],
        eventWitness: "drag:cancel",
        expectedState: "idle",
      },
      {
        id: "dragging",
        sourceState: "dragging",
        setupWitnesses: ["drag:pointer-down", "drag:pointer-move-threshold"],
        eventWitness: "drag:cancel",
        expectedState: "cancelling",
      },
      {
        id: "committing",
        sourceState: "committing",
        setupWitnesses: [
          "drag:pointer-down",
          "drag:pointer-move-threshold",
          "drag:set-candidate",
          "drag:pointer-up",
        ],
        eventWitness: "drag:cancel",
        expectedState: "recovering",
      },
      {
        id: "settling",
        sourceState: "settling",
        setupWitnesses: [
          "drag:pointer-down",
          "drag:pointer-move-threshold",
          "drag:set-candidate",
          "drag:pointer-up",
          "drag:commit-ok",
        ],
        eventWitness: "drag:cancel",
        expectedState: "idle",
      },
    ],
  }),
  "splitter-resize": entry({
    kind: "splitter-resize",
    states: ["idle", "armed", "resizing", "committing", "settling", "cancelling"],
    graphDigest: "40d66a3ae1612598171d2b8fe613325a01b5b168fa99d79de166503515b139ca",
    transitionCount: 23,
    guardedTransitionCount: 8,
    adversarial: {
      "pointer-start": "resize:pointer-start",
      "keyboard-start": "resize:keyboard-start",
      "constraint-result": "resize:constraint-result",
      end: "resize:pointer-end",
      cancel: "resize:cancel",
      "adaptive-delivery-change": "resize:delivery-adaptive",
    },
    interruption: "resize:pointer-cancel",
    recovery: "resize:returned",
    timeoutScenarios: [
      {
        id: "armed",
        sourceState: "armed",
        setupWitnesses: ["resize:pointer-start"],
        eventWitness: "resize:cancel",
        expectedState: "idle",
      },
      {
        id: "resizing",
        sourceState: "resizing",
        setupWitnesses: ["resize:keyboard-start"],
        eventWitness: "resize:cancel",
        expectedState: "cancelling",
      },
      {
        id: "committing",
        sourceState: "committing",
        setupWitnesses: ["resize:keyboard-start", "resize:commit"],
        eventWitness: "resize:cancel",
        expectedState: "cancelling",
      },
      {
        id: "settling",
        sourceState: "settling",
        setupWitnesses: ["resize:keyboard-start", "resize:commit", "resize:commit-ok"],
        eventWitness: "resize:cancel",
        expectedState: "idle",
      },
    ],
  }),
  "floating-manipulation": entry({
    kind: "floating-manipulation",
    states: ["idle", "manipulating", "snapping", "committing", "settling", "recovering"],
    graphDigest: "267fa518a436ba3463b8ff40d13fd46c6e6e05b63414b92bc8e85543d3c24402",
    transitionCount: 25,
    guardedTransitionCount: 8,
    adversarial: {
      // The valid branch is the named witness; the paired invalid bounds
      // sample is accounted for independently as this transition's guard rejection.
      bounds: "floating:move",
      "snap-acquisition": "floating:snap-acquired",
      "snap-release": "floating:snap-released",
      "viewport-change": "floating:viewport-changed",
      "re-grab": "floating:regrab",
    },
    interruption: "floating:pointer-cancel",
    recovery: "floating:recovered",
    timeoutScenarios: [
      {
        id: "manipulating",
        sourceState: "manipulating",
        setupWitnesses: ["floating:start"],
        eventWitness: "floating:cancel",
        expectedState: "recovering",
      },
      {
        id: "snapping",
        sourceState: "snapping",
        setupWitnesses: ["floating:start", "floating:snap-acquired"],
        eventWitness: "floating:cancel",
        expectedState: "recovering",
      },
      {
        id: "committing",
        sourceState: "committing",
        setupWitnesses: ["floating:start", "floating:pointer-end"],
        eventWitness: "floating:cancel",
        expectedState: "recovering",
      },
      {
        id: "settling",
        sourceState: "settling",
        setupWitnesses: ["floating:start", "floating:pointer-end", "floating:commit-ok"],
        eventWitness: "floating:cancel",
        expectedState: "idle",
      },
    ],
  }),
  "keyboard-move": entry({
    kind: "keyboard-move",
    states: ["idle", "choosing-target", "committing", "announcing", "cancelled"],
    graphDigest: "a77303a423dae9e4e18fef32a8e828d411d997494cb6c00e97270a4f90f9f712",
    transitionCount: 15,
    guardedTransitionCount: 1,
    adversarial: {
      "arrow-navigation": "keyboard:navigate",
      "target-class-cycle": "keyboard:cycle",
      enter: "keyboard:commit",
      escape: "keyboard:cancel",
      "target-invalidation": "keyboard:target-invalidated",
    },
    interruption: "keyboard:revision-conflict",
    recovery: "keyboard:restart",
    timeoutScenarios: [
      {
        id: "choosing-target",
        sourceState: "choosing-target",
        setupWitnesses: ["keyboard:start"],
        eventWitness: "keyboard:cancel",
        expectedState: "cancelled",
      },
      {
        id: "committing",
        sourceState: "committing",
        setupWitnesses: ["keyboard:start", "keyboard:commit"],
        eventWitness: "keyboard:cancel",
        expectedState: "cancelled",
      },
      {
        id: "announcing",
        sourceState: "announcing",
        setupWitnesses: ["keyboard:start", "keyboard:commit", "keyboard:commit-ok"],
        eventWitness: "keyboard:cancel",
        expectedState: "idle",
      },
    ],
  }),
  close: entry({
    kind: "close",
    states: [
      "open",
      "requested",
      "checking-guard",
      "committing-close",
      "visual-retirement",
      "disposed",
    ],
    graphDigest: "040a8e4a703c24615c490d3182b4b141f0b46d526c73797bacb43aa45740535e",
    transitionCount: 13,
    guardedTransitionCount: 1,
    adversarial: {
      "guard-allow": "close:guard-allowed",
      "guard-deny": "close:guard-denied",
      "guard-timeout": "close:guard-timeout",
      checkpoint: "close:checkpointed",
      close: "close:commit",
      "undo-preparation": "close:undo-prepared",
    },
    interruption: "close:cancel",
    recovery: "close:visual-finished",
    timeoutScenarios: [
      {
        id: "checking-guard",
        sourceState: "checking-guard",
        setupWitnesses: ["close:request", "close:check-guard"],
        eventWitness: "close:guard-timeout",
        expectedState: "open",
      },
    ],
  }),
  "suspend-resume": entry({
    kind: "suspend-resume",
    states: ["mounted", "suspend-requested", "checkpointing", "suspended", "resuming", "failed"],
    graphDigest: "2bf8b2da9d48dea89cd5e3619937b435d8f6e84359d7b754ff944a58ec867a5d",
    transitionCount: 15,
    guardedTransitionCount: 4,
    adversarial: {
      "visibility-policy": "suspend:visibility",
      "budget-policy": "suspend:budget",
      "checkpoint-success": "suspend:checkpointed",
      "checkpoint-failure": "suspend:checkpoint-failed",
      cancel: "suspend:cancel",
      retry: "suspend:retry-resume",
    },
    interruption: "suspend:resume-cancel",
    recovery: "suspend:resumed",
    timeoutScenarios: [
      {
        id: "checkpointing",
        sourceState: "checkpointing",
        setupWitnesses: ["suspend:budget", "suspend:begin-checkpoint"],
        eventWitness: "suspend:checkpoint-failed",
        expectedState: "failed",
      },
      {
        id: "resuming",
        sourceState: "resuming",
        setupWitnesses: ["suspend:visibility", "suspend:ready", "suspend:request-resume"],
        eventWitness: "suspend:resume-failed",
        expectedState: "failed",
      },
    ],
  }),
  "surface-transfer": entry({
    kind: "surface-transfer",
    states: [
      "source-owned",
      "preparing",
      "bootstrapping",
      "checkpointing",
      "revalidating",
      "ownership-commit",
      "destination-mount",
      "ready",
      "source-release",
      "source-release-retry",
      "compensating",
      "completed",
      "recovered",
      "failed-safe",
    ],
    graphDigest: "d51cd0ba387899914a01769e80c34f7fcc17e2e77a5ec1e47de8a8718765e252",
    transitionCount: 29,
    guardedTransitionCount: 9,
    adversarial: {
      "popup-blocked": "transfer:popup-blocked",
      "protocol-mismatch": "transfer:protocol-mismatch",
      "destination-close": "transfer:destination-closed",
      "source-crash": "transfer:source-crashed",
    },
    interruption: "transfer:cancel",
    recovery: "transfer:compensated",
    timeoutScenarios: [
      {
        id: "preparing",
        sourceState: "preparing",
        setupWitnesses: ["transfer:start"],
        eventWitness: "transfer:deadline:preparing",
        expectedState: "failed-safe",
      },
      {
        id: "bootstrapping",
        sourceState: "bootstrapping",
        setupWitnesses: ["transfer:start", "transfer:prepared"],
        eventWitness: "transfer:deadline:bootstrapping",
        expectedState: "failed-safe",
      },
      {
        id: "checkpointing",
        sourceState: "checkpointing",
        setupWitnesses: ["transfer:start", "transfer:prepared", "transfer:bootstrapped"],
        eventWitness: "transfer:deadline:checkpointing",
        expectedState: "failed-safe",
      },
      {
        id: "revalidating",
        sourceState: "revalidating",
        setupWitnesses: [
          "transfer:start",
          "transfer:prepared",
          "transfer:bootstrapped",
          "transfer:checkpointed",
        ],
        eventWitness: "transfer:deadline:revalidating",
        expectedState: "failed-safe",
      },
      {
        id: "ownership-commit",
        sourceState: "ownership-commit",
        setupWitnesses: [
          "transfer:start",
          "transfer:prepared",
          "transfer:bootstrapped",
          "transfer:checkpointed",
          "transfer:revalidated",
        ],
        eventWitness: "transfer:deadline:ownership-commit",
        expectedState: "failed-safe",
      },
      {
        id: "destination-mount",
        sourceState: "destination-mount",
        setupWitnesses: [
          "transfer:start",
          "transfer:prepared",
          "transfer:bootstrapped",
          "transfer:checkpointed",
          "transfer:revalidated",
          "transfer:ownership-committed",
        ],
        eventWitness: "transfer:deadline:destination-mount",
        expectedState: "compensating",
      },
      {
        id: "ready",
        sourceState: "ready",
        setupWitnesses: [
          "transfer:start",
          "transfer:prepared",
          "transfer:bootstrapped",
          "transfer:checkpointed",
          "transfer:revalidated",
          "transfer:ownership-committed",
          "transfer:destination-mounted",
        ],
        eventWitness: "transfer:deadline:ready",
        expectedState: "compensating",
      },
      {
        id: "source-release",
        sourceState: "source-release",
        setupWitnesses: [
          "transfer:start",
          "transfer:prepared",
          "transfer:bootstrapped",
          "transfer:checkpointed",
          "transfer:revalidated",
          "transfer:ownership-committed",
          "transfer:destination-mounted",
          "transfer:destination-ready",
        ],
        eventWitness: "transfer:deadline:source-release",
        expectedState: "source-release-retry",
      },
      {
        id: "source-release-retry",
        sourceState: "source-release-retry",
        setupWitnesses: [
          "transfer:start",
          "transfer:prepared",
          "transfer:bootstrapped",
          "transfer:checkpointed",
          "transfer:revalidated",
          "transfer:ownership-committed",
          "transfer:destination-mounted",
          "transfer:destination-ready",
          "transfer:deadline:source-release",
        ],
        eventWitness: "transfer:deadline:source-release",
        expectedState: "source-release-retry",
      },
    ],
  }),
  "surface-recovery": entry({
    kind: "surface-recovery",
    states: [
      "healthy",
      "heartbeat-late",
      "disconnected",
      "orphaned",
      "resolving",
      "recovered",
      "failed-safe",
    ],
    graphDigest: "b1fff32e34288ecc6aa49f3755fa5666d27ae2b25604c6c1d5aca82be8e3ce20",
    transitionCount: 17,
    guardedTransitionCount: 7,
    adversarial: {
      "heartbeat-timeout": "recovery:heartbeat-late",
      "epoch-change": "recovery:new-epoch",
      "ownership-proof": "recovery:owner-proof",
      "fallback-placement": "recovery:fallback",
    },
    interruption: "recovery:resolution-failed",
    recovery: "recovery:reset",
    timeoutScenarios: [
      {
        id: "healthy",
        sourceState: "healthy",
        setupWitnesses: [],
        eventWitness: "recovery:heartbeat-late",
        expectedState: "heartbeat-late",
      },
    ],
  }),
  "persistence-worker": entry({
    kind: "persistence-worker",
    states: [
      "idle",
      "batching",
      "writing-journal",
      "checkpointing",
      "compacting",
      "degraded",
      "recovering",
      "stopped",
    ],
    graphDigest: "03ee7315ceb3513427e9b4983e60f080a70e3ddc0ef24abe6692d018137e664c",
    transitionCount: 24,
    guardedTransitionCount: 2,
    adversarial: {
      "queue-threshold": "persistence:enqueue",
      "storage-failure": "persistence:storage-error",
      quota: "persistence:quota-error",
      checksum: "persistence:checksum-error",
      retry: "persistence:retry",
      shutdown: "persistence:stop",
    },
    interruption: "persistence:stop",
    recovery: "persistence:recovered",
    timeoutScenarios: [
      {
        id: "batching-debounce",
        sourceState: "batching",
        setupWitnesses: ["persistence:enqueue"],
        eventWitness: "persistence:flush",
        expectedState: "writing-journal",
      },
    ],
  }),
  "plugin-load": entry({
    kind: "plugin-load",
    states: [
      "unregistered",
      "validating",
      "loading",
      "registering",
      "active",
      "failed",
      "unloading",
    ],
    graphDigest: "25c8c03c62444cd38015e8d55e818f360cba2943eba2c0bd6ef53f6a54a2de9a",
    transitionCount: 20,
    guardedTransitionCount: 0,
    adversarial: {
      "manifest-conflict": "plugin:manifest-conflict",
      "version-conflict": "plugin:version-conflict",
      "renderer-failure": "plugin:renderer-failed",
      "migration-failure": "plugin:migration-failed",
      "scope-close": "plugin:scope-closed",
    },
    interruption: "plugin:scope-closed",
    recovery: "plugin:unloaded",
    timeoutScenarios: [
      {
        id: "loading",
        sourceState: "loading",
        setupWitnesses: ["plugin:register", "plugin:validated"],
        eventWitness: "plugin:load-failed",
        expectedState: "failed",
      },
    ],
  }),
  "view-transition": entry({
    kind: "view-transition",
    states: [
      "eligible",
      "capturing-old",
      "committing",
      "capturing-new",
      "animating",
      "skipped",
      "completed",
    ],
    graphDigest: "137845a680d37928020349e08210a40505a63a42864ca363731c716515d553b1",
    transitionCount: 34,
    guardedTransitionCount: 1,
    adversarial: {
      "higher-priority-command": "view:higher-priority",
      unsupported: "view:unsupported",
      "duplicate-name": "view:duplicate-name",
      "budget-rejection": "view:budget-rejected",
    },
    interruption: "view:higher-priority",
    recovery: "view:fallback-committed",
    timeoutScenarios: [
      {
        id: "eligible",
        sourceState: "eligible",
        setupWitnesses: [],
        eventWitness: "view:timed-out",
        expectedState: "skipped",
      },
      {
        id: "capturing-old",
        sourceState: "capturing-old",
        setupWitnesses: ["view:start"],
        eventWitness: "view:timed-out",
        expectedState: "skipped",
      },
      {
        id: "committing",
        sourceState: "committing",
        setupWitnesses: ["view:start", "view:old-captured"],
        eventWitness: "view:timed-out",
        expectedState: "skipped",
      },
      {
        id: "capturing-new",
        sourceState: "capturing-new",
        setupWitnesses: ["view:start", "view:old-captured", "view:committed"],
        eventWitness: "view:timed-out",
        expectedState: "skipped",
      },
      {
        id: "animating",
        sourceState: "animating",
        setupWitnesses: ["view:start", "view:old-captured", "view:committed", "view:new-captured"],
        eventWitness: "view:timed-out",
        expectedState: "skipped",
      },
    ],
  }),
  "coordinator-election": entry({
    kind: "coordinator-election",
    states: ["follower", "candidate", "leader", "stale", "stepping-down"],
    graphDigest: "b4b3f30fbf5535d118c94762eb7282f5f6496719111df11d60c0b3e44ea66a75",
    transitionCount: 19,
    guardedTransitionCount: 13,
    adversarial: {
      "heartbeat-loss": "election:timeout",
      "epoch-proposal": "election:propose",
      conflict: "election:conflict",
      "server-authority": "election:server-authority",
    },
    interruption: "election:conflict",
    recovery: "election:step-down",
    timeoutScenarios: [
      {
        id: "follower",
        sourceState: "follower",
        setupWitnesses: [],
        eventWitness: "election:timeout",
        expectedState: "candidate",
      },
    ],
  }),
} satisfies Readonly<Record<WorkspaceProtocolKind, ProtocolCoverageContractEntry>>);
