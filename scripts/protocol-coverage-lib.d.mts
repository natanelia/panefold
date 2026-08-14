export interface ProtocolCoverageTotals {
  readonly protocols: number;
  readonly documentedStates: number;
  readonly machineStates: number;
  readonly reachableStates: number;
  readonly documentedTransitions: number;
  readonly machineTransitions: number;
  readonly coveredTransitions: number;
  readonly guardedTransitions: number;
  readonly coveredGuardPasses: number;
  readonly coveredGuardRejections: number;
  readonly obligations: number;
  readonly coveredObligations: number;
  readonly exploredSnapshots: number;
  readonly impossibleEventChecks: number;
  readonly uniqueTimeoutScenarios: number;
  readonly coveredTimeoutScenarios: number;
  readonly deadlinesScheduled: number;
  readonly deadlinesFired: number;
  readonly deadlinesCancelled: number;
  readonly pendingDeadlineHandles: number;
}

export interface ProtocolCoverageEntry {
  readonly kind: string;
  readonly states: CoverageCounts;
  readonly transitions: CoverageCounts;
  readonly guards: {
    readonly documented: number;
    readonly pass: number;
    readonly reject: number;
    readonly missingPass: readonly string[];
    readonly missingReject: readonly string[];
  };
  readonly obligations: {
    readonly documented: number;
    readonly covered: number;
    readonly missing: readonly string[];
  };
  readonly deadline: {
    readonly scenariosDocumented: number;
    readonly scenariosCovered: number;
    readonly missing: readonly string[];
    readonly primaryScheduled: number;
    readonly primaryFired: number;
    readonly replayScheduled: number;
    readonly replayFired: number;
    readonly cancellationScheduled: number;
    readonly cancellationCancelled: number;
    readonly scheduled: number;
    readonly fired: number;
    readonly cancelled: number;
    readonly pendingHandles: number;
    readonly replayEquivalent: boolean;
    readonly transitioned: boolean;
  };
  readonly finalizer: {
    readonly scopeAbortStopsOnce: boolean;
    readonly lateEventIgnored: boolean;
  };
}

interface CoverageCounts {
  readonly documented: number;
  readonly machine: number;
  readonly covered: number;
  readonly missing: readonly string[];
  readonly unexpected: readonly string[];
  readonly unreachable: readonly string[];
}

export function runProtocolCoverage(): {
  readonly protocols: readonly ProtocolCoverageEntry[];
  readonly totals: ProtocolCoverageTotals;
};

export function canonicalMachineGraph(machine: unknown): readonly string[];
