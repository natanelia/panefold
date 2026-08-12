import { describe, expect, it } from "vitest";

import { auditSupportClaims, type ConformanceManifest, type EvidenceRecord } from "../src";

const EVIDENCE: EvidenceRecord = {
  id: "headless-report",
  kind: "automated-test",
  status: "verified",
  verificationClass: "code-verifiable",
  artifactRole: "source",
  uri: "repo://conformance/evidence/headless-report.json",
  sha256: "d".repeat(64),
  producedAt: "2026-08-12T01:02:03Z",
  requirementIds: ["SYS-001"],
  profileIds: ["desktop"],
};

function manifest(status: "stable" | "experimental" = "experimental"): ConformanceManifest {
  return {
    engineVersion: "0.1.0",
    classification: status,
    profiles: [
      {
        id: "desktop",
        status,
        framework: "React",
        browser: "Chromium",
        surfaces: ["main"],
        inputs: ["keyboard"],
        workload: "compact",
        accessibility: ["keyboard-only"],
        features: ["headless-core"],
      },
    ],
    unsupported: [],
    ...(status === "stable" ? { knownLimitations: [] } : {}),
    telemetryDefault: "off",
  };
}

describe("support classification", () => {
  it("accepts an evidence-backed capability scoped to a published profile", () => {
    const report = auditSupportClaims(
      manifest("stable"),
      [
        {
          id: "headless-core",
          classification: "stable",
          profileIds: ["desktop"],
          evidenceIds: [EVIDENCE.id],
          limitations: [],
        },
      ],
      [EVIDENCE],
    );

    expect(report.issues).toEqual([]);
  });

  it("rejects support metadata attached to an unsupported capability", () => {
    const source = { ...manifest(), unsupported: ["browser-popout"] };
    const report = auditSupportClaims(
      source,
      [
        {
          id: "browser-popout",
          classification: "unsupported",
          profileIds: ["desktop"],
          evidenceIds: [EVIDENCE.id],
          limitations: [],
        },
      ],
      [EVIDENCE],
    );

    expect(report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "UNSUPPORTED_CAPABILITY_HAS_SUPPORT_CLAIM",
        "UNSUPPORTED_CAPABILITY_WITHOUT_REASON",
      ]),
    );
  });

  it("cannot hide experimental or unclassified features inside a stable profile", () => {
    const report = auditSupportClaims(
      manifest("stable"),
      [
        {
          id: "headless-core",
          classification: "experimental",
          profileIds: ["desktop"],
          evidenceIds: [EVIDENCE.id],
          limitations: ["Not certified"],
        },
      ],
      [EVIDENCE],
    );

    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "EXPERIMENTAL_FEATURE_IN_STABLE_PROFILE",
        disposition: "invalid",
      }),
    );
  });
});
