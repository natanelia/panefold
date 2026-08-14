import { describe, expect, it } from "vitest";

import { runProtocolCoverage } from "../../../scripts/protocol-coverage-lib.mjs";

describe("Appendix-C protocol state-machine coverage", () => {
  it("covers the exact reviewed graph, guards, obligations, finalizers, and deadlines", () => {
    const coverage = runProtocolCoverage();
    expect(coverage.totals).toMatchObject({
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
      uniqueTimeoutScenarios: 36,
      coveredTimeoutScenarios: 36,
      deadlinesScheduled: 84,
      deadlinesFired: 72,
      deadlinesCancelled: 12,
      pendingDeadlineHandles: 0,
    });
    const expectedScenarios: Readonly<Record<string, number>> = {
      drag: 4,
      "splitter-resize": 4,
      "floating-manipulation": 4,
      "keyboard-move": 3,
      close: 1,
      "suspend-resume": 2,
      "surface-transfer": 9,
      "surface-recovery": 1,
      "persistence-worker": 1,
      "plugin-load": 1,
      "view-transition": 5,
      "coordinator-election": 1,
    };
    for (const protocol of coverage.protocols) {
      const scenarios = expectedScenarios[protocol.kind];
      expect(scenarios, protocol.kind).toBeDefined();
      if (scenarios === undefined) throw new Error(`Unknown protocol ${protocol.kind}`);
      expect(protocol.states.missing, protocol.kind).toEqual([]);
      expect(protocol.states.unexpected, protocol.kind).toEqual([]);
      expect(protocol.transitions.missing, protocol.kind).toEqual([]);
      expect(protocol.transitions.unexpected, protocol.kind).toEqual([]);
      expect(protocol.guards.missingPass, protocol.kind).toEqual([]);
      expect(protocol.guards.missingReject, protocol.kind).toEqual([]);
      expect(protocol.obligations.missing, protocol.kind).toEqual([]);
      expect(protocol.deadline, protocol.kind).toMatchObject({
        scenariosDocumented: scenarios,
        scenariosCovered: scenarios,
        missing: [],
        primaryScheduled: scenarios,
        primaryFired: scenarios,
        replayScheduled: scenarios,
        replayFired: scenarios,
        cancellationScheduled: 1,
        cancellationCancelled: 1,
        scheduled: scenarios * 2 + 1,
        fired: scenarios * 2,
        cancelled: 1,
        pendingHandles: 0,
      });
      expect(protocol.deadline.replayEquivalent, protocol.kind).toBe(true);
      expect(protocol.deadline.transitioned, protocol.kind).toBe(true);
      expect(protocol.finalizer, protocol.kind).toEqual({
        scopeAbortStopsOnce: true,
        lateEventIgnored: true,
      });
    }
  });

  it("replays to a byte-equivalent deterministic report", () => {
    expect(JSON.stringify(runProtocolCoverage())).toBe(JSON.stringify(runProtocolCoverage()));
  });
});
