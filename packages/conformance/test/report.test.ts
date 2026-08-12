import { WORKSPACE_COMMAND_TYPES } from "../../model/src";
import { describe, expect, it } from "vitest";

import {
  PANEFOLD_V1_REQUIREMENT_COUNT,
  generateConformanceReport,
  serializeConformanceReport,
  type ConformanceReportInput,
} from "../src";

function reportInput(
  extraManifestFields: Readonly<Record<string, unknown>> = {},
): ConformanceReportInput {
  return {
    generatedAt: "2026-08-12T01:02:03Z",
    manifest: {
      engineVersion: "0.1.0",
      classification: "experimental",
      generatedAt: "2026-08-12",
      profiles: [
        {
          id: "desktop",
          status: "experimental",
          framework: "React",
          browser: "Chromium",
          surfaces: ["main"],
          inputs: ["keyboard"],
          workload: "compact",
          accessibility: ["automated-semantics-only"],
        },
      ],
      unsupported: [],
      telemetryDefault: "off",
      ...extraManifestFields,
    },
    authoritativeCommandTypes: WORKSPACE_COMMAND_TYPES,
    commandRegistry: WORKSPACE_COMMAND_TYPES.map((type) => ({
      type,
      status: "experimental-implemented",
      execution:
        type === "undo-workspace-operation" || type === "redo-workspace-operation"
          ? "dispatchKernelState"
          : "executeCommand",
      limitations: [],
    })),
    capabilities: [],
    evidence: [],
    requirements: [],
    traces: [],
    hardGates: [],
  };
}

describe("deterministic report generation", () => {
  it("emits unresolved status for absent design evidence and never infers a clock value", () => {
    const report = generateConformanceReport(reportInput());

    expect(report.status).toBe("unresolved");
    expect(report.generatedAt).toBe("2026-08-12T01:02:03Z");
    expect(report.summary.expectedRequirements).toBe(PANEFOLD_V1_REQUIREMENT_COUNT);
    expect(report.summary.definedRequirements).toBe(0);
    expect(report.traceability.missingRequirementIds).toHaveLength(PANEFOLD_V1_REQUIREMENT_COUNT);
  });

  it("is byte-identical across input order and does not consult locale collation", () => {
    const original = String.prototype.localeCompare;
    String.prototype.localeCompare = () => {
      throw new Error("locale state must not be read");
    };
    try {
      const first = generateConformanceReport(reportInput({ ä: true, z: true, A: true }));
      const second = generateConformanceReport(reportInput({ A: true, z: true, ä: true }));
      const firstBytes = serializeConformanceReport(first);
      const secondBytes = serializeConformanceReport(second);

      expect(firstBytes).toBe(secondBytes);
      expect(
        first.issues
          .filter((entry) => entry.code === "UNKNOWN_MANIFEST_FIELD")
          .map((entry) => entry.path),
      ).toEqual(["/A", "/z", "/ä"]);
    } finally {
      String.prototype.localeCompare = original;
    }
  });

  it("marks malformed timestamps and blocked evidence without upgrading either", () => {
    const invalid = generateConformanceReport({ ...reportInput(), generatedAt: "now" });
    const blockedInput = reportInput();
    const blocked = generateConformanceReport({
      ...blockedInput,
      evidence: [
        {
          id: "external-certification",
          kind: "external-certification",
          status: "blocked",
          requirementIds: ["TST-007"],
          profileIds: ["desktop"],
          blockedBy: ["independent assessment not performed"],
        },
      ],
    });

    expect(invalid.status).toBe("invalid");
    expect(blocked.status).toBe("blocked");
  });
});
