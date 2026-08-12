import {
  compareCodeUnits,
  isIdentifier,
  isPlainRecord,
  issue,
  MAX_RECORDS,
  parseStringArray,
  sortIssues,
  unknownKeys,
} from "./internal";
import type {
  CapabilityClaim,
  ConformanceIssue,
  ConformanceManifest,
  EvidenceRecord,
  SupportAuditReport,
  SupportClassification,
} from "./types";

const CAPABILITY_KEYS = new Set([
  "id",
  "classification",
  "profileIds",
  "evidenceIds",
  "limitations",
]);
const CLASSIFICATIONS: ReadonlySet<SupportClassification> = new Set([
  "stable",
  "experimental",
  "deprecated",
  "unsupported",
]);

function parseCapability(
  input: unknown,
  path: string,
  issues: ConformanceIssue[],
): CapabilityClaim | undefined {
  if (!isPlainRecord(input)) {
    issues.push(issue("INVALID_CAPABILITY", "invalid", path, "Expected a plain capability claim."));
    return undefined;
  }
  unknownKeys(input, CAPABILITY_KEYS).forEach((key) => {
    issues.push(
      issue(
        "UNKNOWN_CAPABILITY_FIELD",
        "invalid",
        `${path}/${key}`,
        `Unknown capability field: ${key}`,
      ),
    );
  });
  const id = input.id;
  const classification = input.classification;
  if (!isIdentifier(id)) {
    issues.push(issue("INVALID_CAPABILITY_ID", "invalid", `${path}/id`, "Invalid capability ID."));
  }
  if (
    typeof classification !== "string" ||
    !CLASSIFICATIONS.has(classification as SupportClassification)
  ) {
    issues.push(
      issue(
        "INVALID_CAPABILITY_CLASSIFICATION",
        "invalid",
        `${path}/classification`,
        "Invalid capability classification.",
      ),
    );
  }
  const profileIds = parseStringArray(input.profileIds, `${path}/profileIds`, issues, {
    identifier: true,
  });
  const evidenceIds = parseStringArray(input.evidenceIds, `${path}/evidenceIds`, issues, {
    identifier: true,
  });
  const limitations = parseStringArray(input.limitations, `${path}/limitations`, issues);
  if (
    !isIdentifier(id) ||
    typeof classification !== "string" ||
    !CLASSIFICATIONS.has(classification as SupportClassification) ||
    profileIds === undefined ||
    evidenceIds === undefined ||
    limitations === undefined
  ) {
    return undefined;
  }
  return {
    id,
    classification: classification as SupportClassification,
    profileIds: [...profileIds].sort(compareCodeUnits),
    evidenceIds: [...evidenceIds].sort(compareCodeUnits),
    limitations,
  };
}

export function auditSupportClaims(
  manifest: ConformanceManifest | undefined,
  input: readonly unknown[],
  evidence: readonly EvidenceRecord[],
): SupportAuditReport {
  const issues: ConformanceIssue[] = [];
  const capabilities: CapabilityClaim[] = [];
  const ids = new Set<string>();
  if (input.length > MAX_RECORDS) {
    issues.push(
      issue(
        "CAPABILITY_LIMIT_EXCEEDED",
        "invalid",
        "/capabilities",
        `Capability inventory exceeds ${MAX_RECORDS.toString()} entries.`,
      ),
    );
  } else {
    input.forEach((entry, index) => {
      const parsed = parseCapability(entry, `/capabilities/${index.toString()}`, issues);
      if (parsed === undefined) return;
      if (ids.has(parsed.id)) {
        issues.push(
          issue(
            "DUPLICATE_CAPABILITY",
            "invalid",
            `/capabilities/${index.toString()}/id`,
            `Duplicate capability: ${parsed.id}`,
          ),
        );
        return;
      }
      ids.add(parsed.id);
      capabilities.push(parsed);
    });
  }

  const profileIds = new Set(manifest?.profiles.map((profile) => profile.id) ?? []);
  const evidenceById = new Map(evidence.map((entry) => [entry.id, entry] as const));
  capabilities.forEach((capability) => {
    const path = `/capabilities/${capability.id}`;
    if (capability.classification === "unsupported") {
      if (capability.profileIds.length > 0 || capability.evidenceIds.length > 0) {
        issues.push(
          issue(
            "UNSUPPORTED_CAPABILITY_HAS_SUPPORT_CLAIM",
            "invalid",
            path,
            "Unsupported capabilities cannot claim supported profiles or passing evidence.",
          ),
        );
      }
      if (capability.limitations.length === 0) {
        issues.push(
          issue(
            "UNSUPPORTED_CAPABILITY_WITHOUT_REASON",
            "invalid",
            `${path}/limitations`,
            "Unsupported capabilities need an explicit limitation or reason.",
          ),
        );
      }
      return;
    }

    if (capability.profileIds.length === 0) {
      issues.push(
        issue(
          "CAPABILITY_PROFILE_UNRESOLVED",
          "unresolved",
          `${path}/profileIds`,
          "A supported capability must identify at least one support profile.",
        ),
      );
    }
    capability.profileIds.forEach((profileId) => {
      if (!profileIds.has(profileId)) {
        issues.push(
          issue(
            "UNKNOWN_CAPABILITY_PROFILE",
            "invalid",
            `${path}/profileIds`,
            `Capability references an unpublished profile: ${profileId}`,
          ),
        );
      }
    });
    if (capability.evidenceIds.length === 0) {
      issues.push(
        issue(
          "CAPABILITY_EVIDENCE_UNRESOLVED",
          "unresolved",
          `${path}/evidenceIds`,
          "A supported capability has no evidence reference.",
        ),
      );
    }
    capability.evidenceIds.forEach((evidenceId) => {
      const record = evidenceById.get(evidenceId);
      if (record === undefined) {
        issues.push(
          issue(
            "UNKNOWN_CAPABILITY_EVIDENCE",
            "invalid",
            `${path}/evidenceIds`,
            `Capability references unknown evidence: ${evidenceId}`,
          ),
        );
        return;
      }
      if (capability.classification === "stable" && record.status !== "verified") {
        issues.push(
          issue(
            "STABLE_CAPABILITY_EVIDENCE_UNVERIFIED",
            record.status === "blocked" ? "blocked" : "unresolved",
            `${path}/evidenceIds`,
            `Stable capability evidence is not verified: ${evidenceId}`,
          ),
        );
      }
      capability.profileIds.forEach((profileId) => {
        if (!record.profileIds.includes(profileId)) {
          issues.push(
            issue(
              "EVIDENCE_PROFILE_MISMATCH",
              "unresolved",
              `${path}/evidenceIds`,
              `Evidence ${evidenceId} does not cover profile ${profileId}.`,
            ),
          );
        }
      });
    });
  });

  const manifestUnsupported = new Set(manifest?.unsupported ?? []);
  const classifiedUnsupported = new Set(
    capabilities
      .filter((capability) => capability.classification === "unsupported")
      .map((capability) => capability.id),
  );
  const unclassifiedManifestCapabilities = [...manifestUnsupported]
    .filter((id) => !classifiedUnsupported.has(id))
    .sort(compareCodeUnits);
  const unpublishedUnsupportedCapabilities = [...classifiedUnsupported]
    .filter((id) => !manifestUnsupported.has(id))
    .sort(compareCodeUnits);

  if (manifest === undefined) {
    issues.push(
      issue(
        "SUPPORT_MANIFEST_UNAVAILABLE",
        "unresolved",
        "/manifest",
        "Support classification cannot be reconciled until the manifest is valid.",
      ),
    );
  }
  if (unclassifiedManifestCapabilities.length > 0) {
    issues.push(
      issue(
        "UNSUPPORTED_CAPABILITY_METADATA_MISSING",
        "unresolved",
        "/manifest/unsupported",
        `${unclassifiedManifestCapabilities.length.toString()} unsupported manifest item(s) lack capability metadata: ${unclassifiedManifestCapabilities.join(", ")}`,
      ),
    );
  }
  if (unpublishedUnsupportedCapabilities.length > 0) {
    issues.push(
      issue(
        "UNPUBLISHED_UNSUPPORTED_CAPABILITY",
        "invalid",
        "/manifest/unsupported",
        `Unsupported capability metadata is absent from the manifest: ${unpublishedUnsupportedCapabilities.join(", ")}`,
      ),
    );
  }

  manifest?.profiles.forEach((profile) => {
    profile.features?.forEach((feature) => {
      const capability = capabilities.find((entry) => entry.id === feature);
      if (capability === undefined) {
        issues.push(
          issue(
            "PROFILE_FEATURE_UNCLASSIFIED",
            "unresolved",
            `/manifest/profiles/${profile.id}/features`,
            `Published profile feature lacks capability metadata: ${feature}`,
          ),
        );
      } else if (!capability.profileIds.includes(profile.id)) {
        issues.push(
          issue(
            "PROFILE_FEATURE_SCOPE_MISMATCH",
            "invalid",
            `/manifest/profiles/${profile.id}/features`,
            `Feature ${feature} does not claim profile ${profile.id}.`,
          ),
        );
      } else if (profile.status === "stable" && capability.classification === "experimental") {
        issues.push(
          issue(
            "EXPERIMENTAL_FEATURE_IN_STABLE_PROFILE",
            "invalid",
            `/manifest/profiles/${profile.id}/features`,
            `Experimental feature ${feature} cannot be part of a stable profile claim.`,
          ),
        );
      }
    });
  });

  return {
    capabilities: capabilities.sort((left, right) => compareCodeUnits(left.id, right.id)),
    unclassifiedManifestCapabilities,
    unpublishedUnsupportedCapabilities,
    issues: sortIssues(issues),
  };
}
