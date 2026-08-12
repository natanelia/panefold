import { describe, expect, it } from "vitest";

import { HARD_GATE_IDS, auditHardGates, type EvidenceRecord } from "../src";

const EVIDENCE: EvidenceRecord = {
  id: "model-report",
  kind: "model-report",
  status: "verified",
  uri: "repo://conformance/evidence/model-report.json",
  sha256: "c".repeat(64),
  producedAt: "2026-08-12T01:02:03Z",
  requirementIds: ["TST-001"],
  profileIds: ["desktop"],
};

describe("hard release gates", () => {
  it("models exactly the ten design gates and reports every omitted status", () => {
    const report = auditHardGates([], []);

    expect(HARD_GATE_IDS).toEqual([
      "model-integrity",
      "determinism",
      "atomicity",
      "accessibility",
      "lifecycle",
      "performance",
      "recovery",
      "security",
      "migration",
      "public-evidence",
    ]);
    expect(report.missingGateIds).toEqual(HARD_GATE_IDS);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "HARD_GATES_INCOMPLETE", disposition: "unresolved" }),
    );
  });

  it("requires content-addressed verified evidence and preserves blocked gates", () => {
    const report = auditHardGates(
      [
        { id: "model-integrity", status: "verified", evidenceIds: [EVIDENCE.id] },
        {
          id: "accessibility",
          status: "blocked",
          evidenceIds: [],
          blockedBy: ["manual assistive-technology certification not performed"],
        },
      ],
      [EVIDENCE],
    );

    expect(report.gates).toHaveLength(2);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "HARD_GATE_BLOCKED", disposition: "blocked" }),
    );
  });

  it("rejects a verified label backed by unresolved or missing evidence", () => {
    const unresolvedEvidence: EvidenceRecord = {
      id: "pending-model-report",
      kind: "model-report",
      status: "unresolved",
      requirementIds: ["TST-001"],
      profileIds: ["desktop"],
      note: "Ten-million-operation run is pending.",
    };
    const report = auditHardGates(
      [
        {
          id: "model-integrity",
          status: "verified",
          evidenceIds: [unresolvedEvidence.id, "absent-report"],
        },
      ],
      [unresolvedEvidence],
    );

    expect(report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "UNKNOWN_HARD_GATE_EVIDENCE",
        "VERIFIED_HARD_GATE_USES_UNVERIFIED_EVIDENCE",
      ]),
    );
  });
});
