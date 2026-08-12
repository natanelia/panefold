import {
  compareCodeUnits,
  isBoundedString,
  isIdentifier,
  isPlainRecord,
  isRequirementId,
  isRfc3339,
  issue,
  MAX_RECORDS,
  parseStringArray,
  result,
  sortIssues,
  unknownKeys,
} from "./internal";
import type {
  AuditResult,
  ConformanceIssue,
  EvidenceApproval,
  EvidenceArtifactRole,
  EvidenceKind,
  EvidenceRecord,
  EvidenceStatus,
  EvidenceVerificationClass,
} from "./types";

const EVIDENCE_KEYS = new Set([
  "id",
  "kind",
  "status",
  "verificationClass",
  "artifactRole",
  "uri",
  "sha256",
  "producedAt",
  "requirementIds",
  "profileIds",
  "blockedBy",
  "note",
  "approval",
]);
const APPROVAL_KEYS = new Set(["issuer", "signedAt", "uri", "sha256"]);
const EVIDENCE_KINDS: ReadonlySet<EvidenceKind> = new Set([
  "automated-test",
  "model-report",
  "accessibility-report",
  "performance-report",
  "security-report",
  "migration-report",
  "recovery-report",
  "compatibility-report",
  "manual-assessment",
  "formal-artifact",
  "architecture-decision",
  "external-certification",
  "release-approval",
]);
const EVIDENCE_STATUSES: ReadonlySet<EvidenceStatus> = new Set([
  "verified",
  "unresolved",
  "blocked",
]);
const VERIFICATION_CLASSES: ReadonlySet<EvidenceVerificationClass> = new Set([
  "code-verifiable",
  "environment-verifiable",
  "manual-external",
]);
const ARTIFACT_ROLES: ReadonlySet<EvidenceArtifactRole> = new Set([
  "source",
  "result",
  "attestation",
]);
const MANUAL_EVIDENCE_KINDS: ReadonlySet<EvidenceKind> = new Set([
  "accessibility-report",
  "performance-report",
  "security-report",
  "compatibility-report",
  "manual-assessment",
  "external-certification",
  "release-approval",
]);
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

export function isSha256Digest(value: unknown): value is string {
  return typeof value === "string" && SHA_256_PATTERN.test(value);
}

export function isEvidenceUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return false;
  if (/^urn:[a-z0-9][a-z0-9-]{0,31}:[A-Za-z0-9()+,.:=@;$_!*'/?#-]+$/.test(value)) return true;
  if (/^repo:\/\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(value)) {
    return !value
      .slice("repo://".length)
      .split("/")
      .some((segment) => segment === ".." || segment === ".");
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

function parseRequirementIds(
  input: unknown,
  path: string,
  issues: ConformanceIssue[],
): readonly string[] | undefined {
  if (!Array.isArray(input) || input.length > MAX_RECORDS) {
    issues.push(
      issue(
        "INVALID_REQUIREMENT_REFERENCES",
        "invalid",
        path,
        `Requirement references must be an array of at most ${MAX_RECORDS.toString()} IDs.`,
      ),
    );
    return undefined;
  }
  const result: string[] = [];
  const seen = new Set<string>();
  input.forEach((entry, index) => {
    if (!isRequirementId(entry)) {
      issues.push(
        issue(
          "INVALID_REQUIREMENT_ID",
          "invalid",
          `${path}/${index.toString()}`,
          "Expected an Appendix A requirement ID such as SYS-001.",
        ),
      );
      return;
    }
    if (seen.has(entry)) {
      issues.push(
        issue(
          "DUPLICATE_REQUIREMENT_REFERENCE",
          "invalid",
          `${path}/${index.toString()}`,
          `Duplicate requirement reference: ${entry}`,
        ),
      );
      return;
    }
    seen.add(entry);
    result.push(entry);
  });
  return result;
}

function parseApproval(
  input: unknown,
  path: string,
  issues: ConformanceIssue[],
): EvidenceApproval | undefined {
  if (!isPlainRecord(input)) {
    issues.push(issue("INVALID_APPROVAL", "invalid", path, "Expected a plain approval object."));
    return undefined;
  }
  unknownKeys(input, APPROVAL_KEYS).forEach((key) => {
    issues.push(
      issue(
        "UNKNOWN_APPROVAL_FIELD",
        "invalid",
        `${path}/${key}`,
        `Unknown approval field: ${key}`,
      ),
    );
  });
  if (!isBoundedString(input.issuer)) {
    issues.push(
      issue("INVALID_APPROVAL_ISSUER", "invalid", `${path}/issuer`, "Issuer is required."),
    );
  }
  if (!isRfc3339(input.signedAt)) {
    issues.push(
      issue(
        "INVALID_APPROVAL_DATE",
        "invalid",
        `${path}/signedAt`,
        "Expected an RFC 3339 timestamp.",
      ),
    );
  }
  if (!isEvidenceUri(input.uri)) {
    issues.push(
      issue(
        "INVALID_APPROVAL_URI",
        "invalid",
        `${path}/uri`,
        "Expected an immutable evidence URI.",
      ),
    );
  }
  if (!isSha256Digest(input.sha256)) {
    issues.push(
      issue(
        "INVALID_APPROVAL_HASH",
        "invalid",
        `${path}/sha256`,
        "Expected a lowercase 64-character SHA-256 digest.",
      ),
    );
  }
  if (
    !isBoundedString(input.issuer) ||
    !isRfc3339(input.signedAt) ||
    !isEvidenceUri(input.uri) ||
    !isSha256Digest(input.sha256)
  ) {
    return undefined;
  }
  return {
    issuer: input.issuer,
    signedAt: input.signedAt,
    uri: input.uri,
    sha256: input.sha256,
  };
}

function parseEvidence(
  input: unknown,
  path: string,
  issues: ConformanceIssue[],
): EvidenceRecord | undefined {
  if (!isPlainRecord(input)) {
    issues.push(issue("INVALID_EVIDENCE", "invalid", path, "Expected a plain evidence object."));
    return undefined;
  }
  unknownKeys(input, EVIDENCE_KEYS).forEach((key) => {
    issues.push(
      issue(
        "UNKNOWN_EVIDENCE_FIELD",
        "invalid",
        `${path}/${key}`,
        `Unknown evidence field: ${key}`,
      ),
    );
  });

  const id = input.id;
  const kind = input.kind;
  const status = input.status;
  const verificationClass = input.verificationClass;
  const artifactRole = input.artifactRole;
  if (!isIdentifier(id)) {
    issues.push(
      issue("INVALID_EVIDENCE_ID", "invalid", `${path}/id`, "Invalid evidence identifier."),
    );
  }
  if (typeof kind !== "string" || !EVIDENCE_KINDS.has(kind as EvidenceKind)) {
    issues.push(
      issue("INVALID_EVIDENCE_KIND", "invalid", `${path}/kind`, "Unknown evidence kind."),
    );
  }
  if (typeof status !== "string" || !EVIDENCE_STATUSES.has(status as EvidenceStatus)) {
    issues.push(
      issue("INVALID_EVIDENCE_STATUS", "invalid", `${path}/status`, "Unknown evidence status."),
    );
  }
  if (
    typeof verificationClass !== "string" ||
    !VERIFICATION_CLASSES.has(verificationClass as EvidenceVerificationClass)
  ) {
    issues.push(
      issue(
        "INVALID_EVIDENCE_VERIFICATION_CLASS",
        "invalid",
        `${path}/verificationClass`,
        "Evidence must be classified as code-verifiable, environment-verifiable, or manual-external.",
      ),
    );
  }
  if (
    typeof artifactRole !== "string" ||
    !ARTIFACT_ROLES.has(artifactRole as EvidenceArtifactRole)
  ) {
    issues.push(
      issue(
        "INVALID_EVIDENCE_ARTIFACT_ROLE",
        "invalid",
        `${path}/artifactRole`,
        "Evidence must identify whether its artifact is source, a result, or an attestation.",
      ),
    );
  }

  const requirementIds = parseRequirementIds(
    input.requirementIds,
    `${path}/requirementIds`,
    issues,
  );
  const profileIds = parseStringArray(input.profileIds, `${path}/profileIds`, issues, {
    identifier: true,
  });
  const blockedBy =
    input.blockedBy === undefined
      ? undefined
      : parseStringArray(input.blockedBy, `${path}/blockedBy`, issues, { allowEmpty: false });
  const approval =
    input.approval === undefined
      ? undefined
      : parseApproval(input.approval, `${path}/approval`, issues);

  if (input.uri !== undefined && !isEvidenceUri(input.uri)) {
    issues.push(
      issue(
        "INVALID_EVIDENCE_URI",
        "invalid",
        `${path}/uri`,
        "Evidence URI must use https, urn, or a traversal-free repo URI.",
      ),
    );
  }
  if (input.sha256 !== undefined && !isSha256Digest(input.sha256)) {
    issues.push(
      issue(
        "INVALID_EVIDENCE_HASH",
        "invalid",
        `${path}/sha256`,
        "Expected a lowercase 64-character SHA-256 digest.",
      ),
    );
  }
  if (input.producedAt !== undefined && !isRfc3339(input.producedAt)) {
    issues.push(
      issue(
        "INVALID_EVIDENCE_DATE",
        "invalid",
        `${path}/producedAt`,
        "Expected an RFC 3339 timestamp with a timezone.",
      ),
    );
  }
  if (input.note !== undefined && !isBoundedString(input.note)) {
    issues.push(
      issue("INVALID_EVIDENCE_NOTE", "invalid", `${path}/note`, "Invalid evidence note."),
    );
  }

  if (status === "verified") {
    if (
      !isEvidenceUri(input.uri) ||
      !isSha256Digest(input.sha256) ||
      !isRfc3339(input.producedAt)
    ) {
      issues.push(
        issue(
          "UNPROVEN_VERIFIED_EVIDENCE",
          "invalid",
          path,
          "Verified evidence requires an immutable URI, SHA-256 digest, and production timestamp.",
        ),
      );
    }
    if (blockedBy !== undefined && blockedBy.length > 0) {
      issues.push(
        issue(
          "VERIFIED_EVIDENCE_HAS_BLOCKERS",
          "invalid",
          `${path}/blockedBy`,
          "Verified evidence cannot retain blockers.",
        ),
      );
    }
    if (verificationClass === "manual-external" && approval === undefined) {
      issues.push(
        issue(
          "EXTERNAL_APPROVAL_UNPROVEN",
          "invalid",
          `${path}/approval`,
          "Verified manual or external evidence requires a hashed attestation.",
        ),
      );
    }
  }

  if (verificationClass === "code-verifiable") {
    if (artifactRole === "attestation") {
      issues.push(
        issue(
          "CODE_EVIDENCE_USES_ATTESTATION",
          "invalid",
          `${path}/artifactRole`,
          "Code-verifiable evidence must identify source or an automated result, not an attestation.",
        ),
      );
    }
    if (
      kind === "manual-assessment" ||
      kind === "external-certification" ||
      kind === "release-approval"
    ) {
      issues.push(
        issue(
          "CODE_EVIDENCE_KIND_MISMATCH",
          "invalid",
          `${path}/kind`,
          `Code-verifiable evidence cannot use the ${String(kind)} kind.`,
        ),
      );
    }
  }
  if (verificationClass === "environment-verifiable") {
    if (artifactRole !== "result") {
      issues.push(
        issue(
          "ENVIRONMENT_EVIDENCE_WITHOUT_RESULT",
          "invalid",
          `${path}/artifactRole`,
          "Environment-verifiable evidence must be a recorded execution result.",
        ),
      );
    }
    if (
      kind === "manual-assessment" ||
      kind === "architecture-decision" ||
      kind === "external-certification" ||
      kind === "release-approval"
    ) {
      issues.push(
        issue(
          "ENVIRONMENT_EVIDENCE_KIND_MISMATCH",
          "invalid",
          `${path}/kind`,
          `Environment-verifiable evidence cannot use the ${String(kind)} kind.`,
        ),
      );
    }
  }
  if (verificationClass === "manual-external") {
    if (artifactRole !== "attestation") {
      issues.push(
        issue(
          "MANUAL_EVIDENCE_WITHOUT_ATTESTATION",
          "invalid",
          `${path}/artifactRole`,
          "Manual or external evidence must be an attestation artifact.",
        ),
      );
    }
    if (
      typeof kind === "string" &&
      EVIDENCE_KINDS.has(kind as EvidenceKind) &&
      !MANUAL_EVIDENCE_KINDS.has(kind as EvidenceKind)
    ) {
      issues.push(
        issue(
          "MANUAL_EVIDENCE_KIND_MISMATCH",
          "invalid",
          `${path}/kind`,
          `Manual or external evidence cannot use the ${String(kind)} kind.`,
        ),
      );
    }
  }

  if (status === "verified" && requirementIds?.length === 0) {
    issues.push(
      issue(
        "VERIFIED_EVIDENCE_WITHOUT_REQUIREMENT_SCOPE",
        "invalid",
        `${path}/requirementIds`,
        "Verified evidence must identify at least one requirement that it substantiates.",
      ),
    );
  }
  if (status === "verified" && profileIds?.length === 0) {
    issues.push(
      issue(
        "VERIFIED_EVIDENCE_WITHOUT_PROFILE_SCOPE",
        "invalid",
        `${path}/profileIds`,
        "Verified evidence must identify at least one published profile that it substantiates.",
      ),
    );
  }
  if (status === "blocked") {
    if (blockedBy === undefined || blockedBy.length === 0) {
      issues.push(
        issue(
          "BLOCKED_EVIDENCE_WITHOUT_BLOCKER",
          "invalid",
          `${path}/blockedBy`,
          "Blocked evidence must identify at least one blocker.",
        ),
      );
    }
    issues.push(
      issue("EVIDENCE_BLOCKED", "blocked", path, `Evidence remains blocked: ${String(id)}`),
    );
  }
  if (status === "unresolved") {
    if (!isBoundedString(input.note)) {
      issues.push(
        issue(
          "UNRESOLVED_EVIDENCE_WITHOUT_NOTE",
          "invalid",
          `${path}/note`,
          "Unresolved evidence must explain what remains unresolved.",
        ),
      );
    }
    issues.push(
      issue(
        "EVIDENCE_UNRESOLVED",
        "unresolved",
        path,
        `Evidence remains unresolved: ${String(id)}`,
      ),
    );
  }

  if (
    !isIdentifier(id) ||
    typeof kind !== "string" ||
    !EVIDENCE_KINDS.has(kind as EvidenceKind) ||
    typeof status !== "string" ||
    !EVIDENCE_STATUSES.has(status as EvidenceStatus) ||
    typeof verificationClass !== "string" ||
    !VERIFICATION_CLASSES.has(verificationClass as EvidenceVerificationClass) ||
    typeof artifactRole !== "string" ||
    !ARTIFACT_ROLES.has(artifactRole as EvidenceArtifactRole) ||
    requirementIds === undefined ||
    profileIds === undefined
  ) {
    return undefined;
  }

  return {
    id,
    kind: kind as EvidenceKind,
    status: status as EvidenceStatus,
    verificationClass: verificationClass as EvidenceVerificationClass,
    artifactRole: artifactRole as EvidenceArtifactRole,
    requirementIds: [...requirementIds].sort(compareCodeUnits),
    profileIds: [...profileIds].sort(compareCodeUnits),
    ...(typeof input.uri === "string" ? { uri: input.uri } : {}),
    ...(typeof input.sha256 === "string" ? { sha256: input.sha256 } : {}),
    ...(typeof input.producedAt === "string" ? { producedAt: input.producedAt } : {}),
    ...(blockedBy === undefined ? {} : { blockedBy }),
    ...(typeof input.note === "string" ? { note: input.note } : {}),
    ...(approval === undefined ? {} : { approval }),
  };
}

/** Cross-checks evidence scope against the authoritative requirement and published profile sets. */
export function auditEvidenceScope(
  evidence: readonly EvidenceRecord[],
  requirementIds: readonly string[],
  profileIds: readonly string[],
): readonly ConformanceIssue[] {
  const issues: ConformanceIssue[] = [];
  const requirements = new Set(requirementIds);
  const profiles = new Set(profileIds);
  evidence.forEach((record) => {
    record.requirementIds.forEach((requirementId) => {
      if (!requirements.has(requirementId)) {
        issues.push(
          issue(
            "EVIDENCE_REFERENCES_UNKNOWN_REQUIREMENT",
            "invalid",
            `/evidence/${record.id}/requirementIds`,
            `Evidence references a requirement outside the authoritative inventory: ${requirementId}`,
          ),
        );
      }
    });
    record.profileIds.forEach((profileId) => {
      if (!profiles.has(profileId)) {
        issues.push(
          issue(
            "EVIDENCE_REFERENCES_UNKNOWN_PROFILE",
            "invalid",
            `/evidence/${record.id}/profileIds`,
            `Evidence references an unpublished profile: ${profileId}`,
          ),
        );
      }
    });
  });
  return sortIssues(issues);
}

export function validateEvidenceRecords(input: unknown): AuditResult<readonly EvidenceRecord[]> {
  if (!Array.isArray(input) || input.length > MAX_RECORDS) {
    return result<readonly EvidenceRecord[]>(undefined, [
      issue(
        "INVALID_EVIDENCE_COLLECTION",
        "invalid",
        "/evidence",
        `Evidence must be an array with at most ${MAX_RECORDS.toString()} entries.`,
      ),
    ]);
  }
  const issues: ConformanceIssue[] = [];
  const evidence: EvidenceRecord[] = [];
  const ids = new Set<string>();
  input.forEach((entry, index) => {
    const parsed = parseEvidence(entry, `/evidence/${index.toString()}`, issues);
    if (parsed === undefined) return;
    if (ids.has(parsed.id)) {
      issues.push(
        issue(
          "DUPLICATE_EVIDENCE_ID",
          "invalid",
          `/evidence/${index.toString()}/id`,
          `Duplicate evidence ID: ${parsed.id}`,
        ),
      );
      return;
    }
    ids.add(parsed.id);
    evidence.push(parsed);
  });
  return result(
    evidence.sort((left, right) => compareCodeUnits(left.id, right.id)),
    issues,
  );
}
