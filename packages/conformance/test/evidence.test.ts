import { describe, expect, it } from "vitest";

import { auditEvidenceScope, isEvidenceUri, isSha256Digest, validateEvidenceRecords } from "../src";

const SHA_256 = "a".repeat(64);

describe("evidence records", () => {
  it("accepts content-addressed repository evidence", () => {
    const audit = validateEvidenceRecords([
      {
        id: "kernel-tests",
        kind: "automated-test",
        status: "verified",
        verificationClass: "code-verifiable",
        artifactRole: "source",
        uri: "repo://conformance/evidence/kernel-tests.json",
        sha256: SHA_256,
        producedAt: "2026-08-12T01:02:03Z",
        requirementIds: ["SYS-001", "A11Y-001", "I18N-003"],
        profileIds: ["desktop"],
      },
    ]);

    expect(audit.valid).toBe(true);
    expect(audit.issues).toEqual([]);
    expect(isEvidenceUri("https://example.test/report.json")).toBe(true);
    expect(isEvidenceUri("javascript:alert(1)")).toBe(false);
    expect(isEvidenceUri("repo://reports/../secret")).toBe(false);
    expect(isEvidenceUri("repo:///etc/passwd")).toBe(false);
    expect(isSha256Digest(SHA_256)).toBe(true);
  });

  it("cannot turn a label into verified evidence or fabricate an external approval", () => {
    const audit = validateEvidenceRecords([
      {
        id: "claimed-certification",
        kind: "external-certification",
        status: "verified",
        verificationClass: "manual-external",
        artifactRole: "attestation",
        uri: "notes.txt",
        sha256: "not-a-hash",
        producedAt: "today",
        requirementIds: ["TST-007"],
        profileIds: ["desktop"],
      },
    ]);

    expect(audit.valid).toBe(false);
    expect(audit.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "EXTERNAL_APPROVAL_UNPROVEN",
        "INVALID_EVIDENCE_DATE",
        "INVALID_EVIDENCE_HASH",
        "INVALID_EVIDENCE_URI",
        "UNPROVEN_VERIFIED_EVIDENCE",
      ]),
    );
  });

  it("preserves unresolved and blocked states as report dispositions", () => {
    const audit = validateEvidenceRecords([
      {
        id: "manual-at-matrix",
        kind: "accessibility-report",
        status: "unresolved",
        verificationClass: "manual-external",
        artifactRole: "attestation",
        requirementIds: ["TST-007"],
        profileIds: ["desktop"],
        note: "Manual assistive-technology runs have not been performed.",
      },
      {
        id: "external-review",
        kind: "external-certification",
        status: "blocked",
        verificationClass: "manual-external",
        artifactRole: "attestation",
        requirementIds: ["TST-007"],
        profileIds: ["desktop"],
        blockedBy: ["independent reviewer not engaged"],
      },
    ]);

    expect(audit.valid).toBe(true);
    expect(audit.issues.map((entry) => entry.disposition)).toEqual(["unresolved", "blocked"]);
  });

  it("does not relabel source or unsigned review material as stronger evidence", () => {
    const audit = validateEvidenceRecords([
      {
        id: "browser-source-only",
        kind: "automated-test",
        status: "verified",
        verificationClass: "environment-verifiable",
        artifactRole: "source",
        uri: "repo://site-e2e/workspace.spec.ts",
        sha256: SHA_256,
        producedAt: "2026-08-12T01:02:03Z",
        requirementIds: ["A11Y-003"],
        profileIds: ["desktop"],
      },
      {
        id: "unsigned-manual-review",
        kind: "manual-assessment",
        status: "verified",
        verificationClass: "manual-external",
        artifactRole: "attestation",
        uri: "repo://reports/manual-review.json",
        sha256: SHA_256,
        producedAt: "2026-08-12T01:02:03Z",
        requirementIds: ["A11Y-008"],
        profileIds: ["desktop"],
      },
    ]);

    expect(audit.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["ENVIRONMENT_EVIDENCE_WITHOUT_RESULT", "EXTERNAL_APPROVAL_UNPROVEN"]),
    );
  });

  it("rejects evidence scope outside the authoritative requirements and profiles", () => {
    const audit = validateEvidenceRecords([
      {
        id: "mis-scoped-source",
        kind: "automated-test",
        status: "verified",
        verificationClass: "code-verifiable",
        artifactRole: "source",
        uri: "repo://tests/source.test.ts",
        sha256: SHA_256,
        producedAt: "2026-08-12T01:02:03Z",
        requirementIds: ["FAKE-001"],
        profileIds: ["absent"],
      },
    ]);

    expect(
      auditEvidenceScope(audit.value ?? [], ["SYS-001"], ["desktop"]).map((entry) => entry.code),
    ).toEqual(["EVIDENCE_REFERENCES_UNKNOWN_PROFILE", "EVIDENCE_REFERENCES_UNKNOWN_REQUIREMENT"]);
  });
});
