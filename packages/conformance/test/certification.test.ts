import certificationSchema from "../schema/certification.schema.json";
import certificationTemplate from "../schema/certification.template.json";
import { describe, expect, it } from "vitest";

import { validateThirdPartyCertificationManifest } from "../src";

const HASH = "a".repeat(64);

describe("third-party certification metadata", () => {
  it("accepts the public candidate template without treating it as an approval", () => {
    const audit = validateThirdPartyCertificationManifest(certificationTemplate);

    expect(audit.valid).toBe(true);
    expect(audit.value).toMatchObject({
      status: "candidate",
      subject: { kind: "adapter", packageName: "@example/panefold-adapter" },
      profile: { id: "example-adapter-chromium-desktop" },
    });
    expect(audit.value?.evidence[0]?.requirementIds).toEqual(["EXT-006", "FWK-001", "GOV-006"]);
    expect(audit.value?.approval).toBeUndefined();
  });

  it("accepts certified metadata only with a hashed approval newer than its artifacts", () => {
    const audit = validateThirdPartyCertificationManifest({
      ...certificationTemplate,
      status: "certified",
      approval: {
        issuer: "Independent Panefold compatibility assessor",
        signedAt: "2026-08-12T02:03:04Z",
        uri: "https://example.test/panefold/approvals/example-adapter.json",
        sha256: HASH,
      },
    });

    expect(audit.valid).toBe(true);
    expect(audit.value?.approval?.issuer).toContain("Independent");
  });

  it("rejects certified metadata without third-party approval", () => {
    const audit = validateThirdPartyCertificationManifest({
      ...certificationTemplate,
      status: "certified",
    });

    expect(audit.valid).toBe(false);
    expect(audit.value?.status).toBe("certified");
    expect(audit.value?.approval).toBeUndefined();
    expect(audit.issues).toContainEqual(
      expect.objectContaining({
        code: "CERTIFICATION_WITHOUT_APPROVAL",
        disposition: "invalid",
        path: "/approval",
      }),
    );
  });

  it("rejects claim inflation, unknown requirements, profile drift, and stale approval", () => {
    const evidence = certificationTemplate.evidence[0];
    const audit = validateThirdPartyCertificationManifest({
      ...certificationTemplate,
      status: "certified",
      evidence: [
        {
          ...evidence,
          profileId: "different-profile",
          requirementIds: ["FAKE-001"],
          producedAt: "2026-08-13T01:02:03Z",
        },
      ],
      approval: {
        issuer: "Assessor",
        signedAt: "2026-08-12T02:03:04Z",
        uri: "https://example.test/approval.json",
        sha256: HASH,
      },
      surprise: true,
    });

    expect(audit.valid).toBe(false);
    expect(audit.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "APPROVAL_PREDATES_EVIDENCE",
        "CERTIFICATION_ARTIFACT_PROFILE_MISMATCH",
        "UNKNOWN_CERTIFICATION_FIELD",
        "UNKNOWN_CERTIFICATION_REQUIREMENT",
      ]),
    );
  });

  it("publishes a closed Draft 2020-12 schema with approval-gated certified status", () => {
    expect(certificationSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(certificationSchema.additionalProperties).toBe(false);
    expect(certificationSchema.properties.status.enum).toEqual(["candidate", "certified"]);
    expect(certificationSchema.properties.subject.additionalProperties).toBe(false);
    expect(certificationSchema.$defs.evidence.additionalProperties).toBe(false);
    expect(certificationSchema.allOf).toContainEqual(
      expect.objectContaining({ then: { required: ["approval"] } }),
    );
  });
});
