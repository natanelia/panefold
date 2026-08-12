import { WORKSPACE_COMMAND_TYPES } from "@panefold/model";
import { describe, expect, it } from "vitest";

import {
  STRUCTURAL_ACTION_PARITY,
  TEST_PANEL_FIXTURES,
  WORKLOAD_MANIFESTS,
  assessPerformanceRegression,
  auditStructuralActionParity,
  checkPreparedTransferOwnership,
  summarizeSamples,
  validateWorkloadManifest,
} from "../src";

describe("reference workload manifests", () => {
  it("defines every normative workload with valid, immutable data", () => {
    expect(Object.keys(WORKLOAD_MANIFESTS)).toEqual([
      "compact",
      "professional",
      "ide-scale",
      "large",
      "heavy-content",
      "lifecycle-torture",
      "accessibility-stress",
      "failure-stress",
    ]);
    for (const manifest of Object.values(WORKLOAD_MANIFESTS)) {
      expect(validateWorkloadManifest(manifest)).toEqual([]);
      expect(Object.isFrozen(manifest)).toBe(true);
    }
    expect(WORKLOAD_MANIFESTS["lifecycle-torture"].cycles).toBe(10_000);
  });
});

describe("representative panel fixtures", () => {
  it("covers every fixture class named by the normative testkit", () => {
    expect(TEST_PANEL_FIXTURES).toHaveLength(17);
    expect(new Set(TEST_PANEL_FIXTURES.map((fixture) => fixture.kind)).size).toBe(17);
    expect(TEST_PANEL_FIXTURES.some((fixture) => fixture.kind === "webgl-map")).toBe(true);
    expect(
      TEST_PANEL_FIXTURES.some((fixture) => fixture.kind === "missing-plugin-placeholder"),
    ).toBe(true);
  });
});

describe("structural action parity", () => {
  it("gives every pointer action a deterministic label and non-pointer route", () => {
    expect(auditStructuralActionParity(STRUCTURAL_ACTION_PARITY)).toEqual([]);
    for (const entry of STRUCTURAL_ACTION_PARITY) {
      expect(WORKSPACE_COMMAND_TYPES).toContain(entry.commandType);
    }
  });
});

describe("ownership model", () => {
  it("exhausts stale, duplicate, reordered, cancellation, and loss transitions", () => {
    const report = checkPreparedTransferOwnership(12);
    expect(report.states).toBeGreaterThan(10);
    expect(report.transitions).toBeGreaterThan(100);
    expect(report.violations).toEqual([]);
  });
});

describe("benchmark statistics", () => {
  it("publishes deterministic distribution and confidence summaries", () => {
    expect(summarizeSamples([1, 2, 3, 4, 5])).toMatchObject({
      count: 5,
      minimum: 1,
      maximum: 5,
      mean: 3,
      median: 3,
      p95: 4.8,
      p99: 4.96,
    });
    expect(() => summarizeSamples([])).toThrow(RangeError);
    expect(() => summarizeSamples([1, Number.NaN])).toThrow(RangeError);
  });

  it("detects only statistically separated regressions beyond tolerance", () => {
    const baseline = [9, 10, 10, 10, 11, 9, 10, 10, 10, 11];
    const regression = [14, 15, 15, 15, 16, 14, 15, 15, 15, 16];
    expect(
      assessPerformanceRegression(baseline, regression, {
        direction: "lower-is-better",
        maximumRelativeRegression: 0.1,
      }),
    ).toMatchObject({ status: "regression", statisticallySeparated: true });
    expect(
      assessPerformanceRegression(baseline, baseline, {
        direction: "lower-is-better",
        maximumRelativeRegression: 0.1,
      }),
    ).toMatchObject({ status: "inconclusive", statisticallySeparated: false });
  });
});
