import { WORKSPACE_COMMAND_TYPES } from "@panefold/model";
import { describe, expect, it } from "vitest";

import { runDifferentialSequence } from "../src/index";
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
});
