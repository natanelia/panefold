import { describe, expect, it } from "vitest";

import currentRequirements from "../../../conformance/requirements.json";

import {
  PANEFOLD_V1_REQUIREMENT_COUNT,
  PANEFOLD_V1_REQUIREMENT_IDS,
  auditRequirementTraceability,
  type EvidenceRecord,
  type SupportProfile,
} from "../src";

const PROFILE: SupportProfile = {
  id: "desktop",
  status: "stable",
  framework: "React",
  browser: "Chromium",
  surfaces: ["main"],
  inputs: ["keyboard"],
  workload: "compact",
  accessibility: ["keyboard-only"],
};

const EVIDENCE: EvidenceRecord = {
  id: "authority-test",
  kind: "automated-test",
  status: "verified",
  uri: "repo://conformance/evidence/authority-test.json",
  sha256: "b".repeat(64),
  producedAt: "2026-08-12T01:02:03Z",
  requirementIds: ["SYS-001"],
  profileIds: [PROFILE.id],
};

describe("requirement traceability", () => {
  it("contains all 190 exact Appendix A IDs, including digit-bearing families", () => {
    expect(PANEFOLD_V1_REQUIREMENT_IDS).toHaveLength(PANEFOLD_V1_REQUIREMENT_COUNT);
    expect(new Set(PANEFOLD_V1_REQUIREMENT_IDS).size).toBe(PANEFOLD_V1_REQUIREMENT_COUNT);
    expect(PANEFOLD_V1_REQUIREMENT_IDS).toContain("A11Y-008");
    expect(PANEFOLD_V1_REQUIREMENT_IDS).toContain("I18N-003");
    expect(currentRequirements.requirements.map((entry) => entry.id).sort()).toEqual(
      [...PANEFOLD_V1_REQUIREMENT_IDS].sort(),
    );

    const audit = auditRequirementTraceability({
      profiles: [],
      evidence: [],
      requirements: currentRequirements.requirements,
      traces: [],
    });
    expect(audit.definedRequirementIds).toHaveLength(PANEFOLD_V1_REQUIREMENT_COUNT);
    expect(audit.missingRequirementIds).toEqual([]);
    expect(audit.unknownRequirementIds).toEqual([]);
    expect(audit.issues).toEqual([]);
  });

  it("verifies an exact trace only when its artifact covers the requirement and profile", () => {
    const report = auditRequirementTraceability({
      expectedRequirementIds: ["SYS-001"],
      profiles: [PROFILE],
      evidence: [EVIDENCE],
      requirements: [{ id: "SYS-001", level: "MUST", applicability: "universal" }],
      traces: [
        {
          requirementId: "SYS-001",
          profileId: PROFILE.id,
          status: "verified",
          evidenceIds: [EVIDENCE.id],
        },
      ],
    });

    expect(report.missingRequirementIds).toEqual([]);
    expect(report.missingTraceKeys).toEqual([]);
    expect(report.issues).toEqual([]);
  });

  it("emits explicit unresolved inventories rather than treating omissions as passes", () => {
    const report = auditRequirementTraceability({
      expectedRequirementIds: ["SYS-001", "TST-007"],
      profiles: [PROFILE],
      evidence: [],
      requirements: [],
      traces: [],
    });

    expect(report.missingRequirementIds).toEqual(["SYS-001", "TST-007"]);
    expect(report.missingTraceKeys).toEqual(["SYS-001@desktop", "TST-007@desktop"]);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "REQUIREMENT_DEFINITIONS_INCOMPLETE" }),
    );
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "REQUIREMENT_TRACES_INCOMPLETE" }),
    );
  });

  it("rejects invented IDs and universal requirements marked not applicable", () => {
    const report = auditRequirementTraceability({
      expectedRequirementIds: ["SYS-001"],
      profiles: [PROFILE],
      evidence: [],
      requirements: [
        { id: "SYS-001", level: "MUST", applicability: "universal" },
        { id: "FAKE-001", level: "MUST", applicability: "universal" },
      ],
      traces: [
        {
          requirementId: "SYS-001",
          profileId: PROFILE.id,
          status: "not-applicable",
          evidenceIds: [],
          rationale: "Convenient to omit",
        },
      ],
    });

    expect(report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "UNKNOWN_REQUIREMENT_DEFINITION",
        "UNIVERSAL_REQUIREMENT_MARKED_NOT_APPLICABLE",
      ]),
    );
  });
});
