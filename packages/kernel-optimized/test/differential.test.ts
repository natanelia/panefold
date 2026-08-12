import { executeCommand } from "@panefold/kernel";
import { WORKSPACE_COMMAND_TYPES } from "@panefold/model";
import { describe, expect, it } from "vitest";

import {
  createDifferentialCampaign,
  runDifferentialSequence,
  runLongDifferentialCampaign,
  serializeDifferentialCampaignReport,
} from "../src/index";
import { fixtureSnapshot } from "./fixtures";

describe("reference-kernel differential runner", () => {
  it("has zero divergence across repeatable seeded command sequences", () => {
    for (const seed of [1, 7, 42, 2_026_081_2]) {
      const report = runDifferentialSequence({
        initial: fixtureSnapshot(),
        seed,
        steps: 250,
        projection: { bucketCount: 16, historyLimit: 300, historyChunkSize: 16 },
      });
      expect(report.divergences, `seed ${seed}`).toEqual([]);
      expect(report.accepted, `seed ${seed}`).toBeGreaterThan(100);
      expect(report.projection.history.size).toBe(report.accepted);
      expect(report.projection.snapshot.revision).toBe(BigInt(report.accepted));
    }
  });

  it("passes the exhaustive command registry to custom generators", () => {
    const observed: string[][] = [];
    const report = runDifferentialSequence({
      initial: fixtureSnapshot(),
      seed: 9,
      steps: 3,
      generate: ({ commandTypes, snapshot }) => {
        observed.push([...commandTypes]);
        return { type: "restore-workspace", snapshot };
      },
    });
    expect(observed).toEqual(Array.from({ length: 3 }, () => [...WORKSPACE_COMMAND_TYPES]));
    expect(report.divergences).toEqual([]);
    expect(report.accepted).toBe(3);
  });

  it("continues one reproducible random stream across bounded chunks", () => {
    const chunked = createDifferentialCampaign({
      initial: fixtureSnapshot(),
      seed: 73,
      projection: { historyLimit: 0 },
    });
    chunked.runChunk(40);
    const chunkedReport = chunked.runChunk(60);
    const single = createDifferentialCampaign({
      initial: fixtureSnapshot(),
      seed: 73,
      projection: { historyLimit: 0 },
    });
    const singleReport = single.runChunk(100);

    expect(serializeDifferentialCampaignReport(chunkedReport)).toBe(
      serializeDifferentialCampaignReport(singleReport),
    );
    expect(chunked.randomState).toBe(single.randomState);
  });

  it("generates an honest machine-readable model report", () => {
    const campaign = createDifferentialCampaign({ initial: fixtureSnapshot(), seed: 91 });
    const report = campaign.runChunk(25);
    const serialized = serializeDifferentialCampaignReport(report);

    expect(report).toMatchObject({
      schemaVersion: 1,
      runner: "panefold-differential-campaign",
      completedSteps: 25,
      divergenceCount: 0,
      implementation: {
        candidateId: "@panefold/kernel-optimized.patch-projection",
        independentCandidate: false,
      },
      generatorId: "panefold.comprehensive-workspace.v1",
      thresholds: { generatedOperationTarget: 10_000_000, generatedOperationTargetMet: false },
      phaseOneDifferentialEligible: false,
      status: "passed",
    });
    expect(JSON.parse(serialized)).toEqual(report);
  });

  it("yields between long-run chunks without changing the report", async () => {
    let yields = 0;
    const progress: number[] = [];
    const report = await runLongDifferentialCampaign({
      initial: fixtureSnapshot(),
      seed: 97,
      steps: 25,
      chunkSize: 10,
      yieldControl: async () => {
        yields += 1;
      },
      onProgress: (current) => progress.push(current.completedSteps),
    });
    const synchronous = createDifferentialCampaign({
      initial: fixtureSnapshot(),
      seed: 97,
    }).runChunk(25);

    expect(progress).toEqual([10, 20, 25]);
    expect(yields).toBe(2);
    expect(serializeDifferentialCampaignReport(report)).toBe(
      serializeDifferentialCampaignReport(synchronous),
    );
  });

  it("compares an injected reducing candidate after every generated command", () => {
    const report = createDifferentialCampaign({
      initial: fixtureSnapshot(),
      seed: 101,
      candidate: {
        id: "test-independent-candidate",
        independent: true,
        execute: executeCommand,
      },
    }).runChunk(50);

    expect(report.divergences).toEqual([]);
    expect(report.checks.candidateComparisons).toBe(50);
    expect(report.implementation).toMatchObject({
      candidateId: "test-independent-candidate",
      independentCandidate: true,
    });
    expect(report.phaseOneDifferentialEligible).toBe(false);
  });

  it("stops at and classifies the first candidate divergence", () => {
    const report = createDifferentialCampaign({
      initial: fixtureSnapshot(),
      seed: 111,
      candidate: {
        id: "broken-candidate",
        independent: true,
        execute(snapshot, envelope) {
          const result = executeCommand(snapshot, envelope);
          if (!result.ok) return result;
          return {
            ...result,
            next: Object.freeze({ ...result.next, metadata: { broken: true } }),
          };
        },
      },
    }).runChunk(100);

    expect(report.status).toBe("diverged");
    expect(report.completedSteps).toBe(1);
    expect(report.divergenceCount).toBe(1);
    expect(report.divergences[0]?.kind).toBe("candidate-state");
  });
});
