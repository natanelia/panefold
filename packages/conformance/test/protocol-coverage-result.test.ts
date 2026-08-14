import { describe, expect, it } from "vitest";

import {
  PROTOCOL_COVERAGE_SOURCE_DIGEST_PATHS,
  verifyProtocolCoverageResult,
} from "../../../scripts/verify-protocol-coverage.mjs";

const protocolKinds = [
  "drag",
  "splitter-resize",
  "floating-manipulation",
  "keyboard-move",
  "close",
  "suspend-resume",
  "surface-transfer",
  "surface-recovery",
  "persistence-worker",
  "plugin-load",
  "view-transition",
  "coordinator-election",
] as const;

describe("protocol state-machine coverage result", () => {
  it("accepts only complete, exact, deterministic protocol coverage", () => {
    expect(verifyProtocolCoverageResult(completeResult())).toEqual([]);
  });

  it("rejects a green label with missing transitions, guards, deadlines, or obligations", () => {
    const result = completeResult();
    const first = result.protocols[0];
    if (first === undefined) throw new Error("Missing protocol fixture");
    first.transitions.covered = 0;
    first.transitions.missing.push("drag:idle:POINTER_DOWN:0");
    first.guards.reject = 0;
    first.guards.missingReject.push("drag:armed:POINTER_MOVE:0");
    first.deadline.pendingHandles = 1;
    const timeout = first.obligations.byKind.timeout;
    if (timeout === undefined) throw new Error("Missing timeout obligation fixture");
    timeout.covered = 0;

    const failures = verifyProtocolCoverageResult(result);

    expect(failures).toEqual(
      expect.arrayContaining([
        "drag transitions must have exact documented, machine, and covered parity.",
        "drag transitions.missing must be an empty array.",
        "drag must observe both pass and rejection for every documented guard.",
        "drag guards.missingReject must be an empty array.",
        "drag timeout obligations must be non-empty and fully covered.",
        "drag must leave no pending deadline handle.",
      ]),
    );
  });

  it("rejects a fabricated zero-count green report", () => {
    const result = completeResult();
    for (const protocol of result.protocols) {
      protocol.states.documented = 0;
      protocol.states.machine = 0;
      protocol.states.covered = 0;
      protocol.transitions.documented = 0;
      protocol.transitions.machine = 0;
      protocol.transitions.covered = 0;
      protocol.guards.documented = 0;
      protocol.guards.pass = 0;
      protocol.guards.reject = 0;
    }
    for (const key of [
      "documentedStates",
      "machineStates",
      "reachableStates",
      "documentedTransitions",
      "machineTransitions",
      "coveredTransitions",
      "guardedTransitions",
      "coveredGuardPasses",
      "coveredGuardRejections",
    ] as const) {
      result.totals[key] = 0;
    }

    expect(verifyProtocolCoverageResult(result)).toEqual(
      expect.arrayContaining([
        "drag states.documented must equal 7.",
        "drag transitions.documented must equal 24.",
        "drag guards.documented must equal 10.",
        "Protocol coverage totals.documentedStates must equal 84.",
        "Protocol coverage totals.documentedTransitions must equal 258.",
        "Protocol coverage totals.guardedTransitions must equal 64.",
      ]),
    );
  });

  it("rejects obligation redistribution, provenance omission, and claim broadening", () => {
    const result = completeResult();
    const drag = result.protocols[0];
    if (drag === undefined) throw new Error("Missing protocol fixture");
    const adversarial = drag.obligations.byKind.adversarial;
    const timeout = drag.obligations.byKind.timeout;
    if (adversarial === undefined || timeout === undefined) {
      throw new Error("Missing obligation fixture");
    }
    adversarial.documented -= 1;
    adversarial.covered -= 1;
    timeout.documented += 1;
    timeout.covered += 1;
    result.sourceDigests = { "pnpm-lock.yaml": "a".repeat(64) };
    result.scope = "all-platform-failures-certified";
    result.limitations = ["Complete certification"];

    expect(verifyProtocolCoverageResult(result)).toEqual(
      expect.arrayContaining([
        "Protocol coverage scope must remain the twelve headless Appendix-C actors.",
        "drag adversarial obligations.documented must equal 7.",
        "drag timeout obligations.documented must equal 4.",
        "Protocol coverage sourceDigests must bind the exact reviewed source set.",
        "Protocol coverage must publish the three reviewed claim limitations.",
      ]),
    );
  });
});

function completeResult() {
  const counts: Record<
    (typeof protocolKinds)[number],
    readonly [number, number, number, number, number]
  > = {
    drag: [7, 24, 10, 15, 4],
    "splitter-resize": [6, 23, 8, 14, 4],
    "floating-manipulation": [6, 25, 8, 13, 4],
    "keyboard-move": [5, 15, 1, 12, 3],
    close: [6, 13, 1, 11, 1],
    "suspend-resume": [6, 15, 4, 12, 2],
    "surface-transfer": [14, 29, 9, 17, 9],
    "surface-recovery": [7, 17, 7, 9, 1],
    "persistence-worker": [8, 24, 2, 11, 1],
    "plugin-load": [7, 20, 0, 10, 1],
    "view-transition": [7, 34, 1, 13, 5],
    "coordinator-election": [5, 19, 13, 9, 1],
  } as const;
  const protocols = protocolKinds.map((kind, index) => {
    const [stateCount, transitionCount, guardCount, obligationCount, timeoutScenarioCount] =
      counts[kind];
    const adversarialCount = obligationCount - timeoutScenarioCount - 4;
    return {
      kind,
      states: {
        documented: stateCount,
        machine: stateCount,
        covered: stateCount,
        missing: [] as string[],
        unexpected: [] as string[],
        unreachable: [] as string[],
      },
      transitions: {
        documented: transitionCount,
        machine: transitionCount,
        covered: transitionCount,
        missing: [] as string[],
        unexpected: [] as string[],
        unreachable: [] as string[],
      },
      guards: {
        documented: guardCount,
        pass: guardCount,
        reject: guardCount,
        missingPass: [] as string[],
        missingReject: [] as string[],
      },
      obligations: {
        documented: obligationCount,
        covered: obligationCount,
        missing: [] as string[],
        byKind: Object.fromEntries(
          [
            ["adversarial", adversarialCount],
            ["interruption", 1],
            ["timeout", timeoutScenarioCount],
            ["recovery", 1],
            ["finalizer", 1],
            ["impossible-event", 1],
          ].map(([obligationKind, count]) => [
            obligationKind,
            { documented: count, covered: count },
          ]),
        ) as Record<string, { documented: number; covered: number }>,
      },
      exploredSnapshots: index === 0 ? 522 : 1,
      impossibleEventChecks: index === 0 ? 7_826 : 1,
      deadline: {
        scenariosDocumented: timeoutScenarioCount,
        scenariosCovered: timeoutScenarioCount,
        missing: [] as string[],
        primaryScheduled: timeoutScenarioCount,
        primaryFired: timeoutScenarioCount,
        replayScheduled: timeoutScenarioCount,
        replayFired: timeoutScenarioCount,
        cancellationScheduled: 1,
        cancellationCancelled: 1,
        scheduled: timeoutScenarioCount * 2 + 1,
        fired: timeoutScenarioCount * 2,
        cancelled: 1,
        pendingHandles: 0,
        replayEquivalent: true,
        transitioned: true,
      },
      finalizer: { scopeAbortStopsOnce: true, lateEventIgnored: true },
    };
  });
  return {
    schemaVersion: 1,
    kind: "protocol-state-machine-coverage",
    status: "passed",
    producedAt: "2026-08-14T00:00:00Z",
    scope: "twelve-headless-appendix-c-protocol-actors",
    runner: {
      command: "pnpm protocol:coverage:check",
      nodeMajorVersions: [22, 24],
      xstate: "5.32.5",
      traversal: "bounded-breadth-first-v1",
      deterministicScheduler: "virtual-fifo-v1",
      maxSnapshotsPerProtocolInput: 1_000,
      maxExploredSnapshots: 20_000,
    },
    protocols,
    totals: {
      protocols: 12,
      documentedStates: 84,
      machineStates: 84,
      reachableStates: 84,
      documentedTransitions: 258,
      machineTransitions: 258,
      coveredTransitions: 258,
      guardedTransitions: 64,
      coveredGuardPasses: 64,
      coveredGuardRejections: 64,
      obligations: 146,
      coveredObligations: 146,
      exploredSnapshots: 533,
      impossibleEventChecks: 7_837,
      uniqueTimeoutScenarios: 36,
      coveredTimeoutScenarios: 36,
      deadlinesScheduled: 84,
      deadlinesFired: 72,
      deadlinesCancelled: 12,
      pendingDeadlineHandles: 0,
    },
    sourceDigests: Object.fromEntries(
      PROTOCOL_COVERAGE_SOURCE_DIGEST_PATHS.map((path) => [path, "a".repeat(64)]),
    ),
    limitations: [
      "This headless result is not browser, operating-system, or process-crash certification.",
      "Abstract failure events do not replace storage-media or distributed hosting evidence.",
      "TST-009 remains unresolved.",
    ],
  };
}
