import { isEvidenceUri, isSha256Digest } from "./evidence";
import {
  compareCodeUnits,
  isBoundedString,
  isIdentifier,
  isPlainRecord,
  isRequirementId,
  isRfc3339,
  isSemver,
  issue,
  MAX_RECORDS,
  parseStringArray,
  result,
  unknownKeys,
} from "./internal";
import { PANEFOLD_V1_REQUIREMENT_IDS } from "./requirements";
import type {
  AuditResult,
  CertificationEvidenceArtifact,
  CertificationProfile,
  CertificationStatus,
  CertificationSubject,
  CertificationSubjectKind,
  CertificationVersions,
  ConformanceIssue,
  EvidenceApproval,
  EvidenceKind,
  ThirdPartyCertificationManifest,
} from "./types";

const MANIFEST_KEYS = new Set([
  "$schema",
  "schemaVersion",
  "certificationId",
  "status",
  "subject",
  "versions",
  "profile",
  "evidence",
  "approval",
]);
const SUBJECT_KEYS = new Set(["kind", "id", "packageName"]);
const VERSION_KEYS = new Set(["subject", "engine", "protocol", "framework", "browser"]);
const PROFILE_KEYS = new Set(["id", "surfaces", "inputs", "workload"]);
const ARTIFACT_KEYS = new Set([
  "id",
  "kind",
  "uri",
  "sha256",
  "producedAt",
  "requirementIds",
  "profileId",
]);
const APPROVAL_KEYS = new Set(["issuer", "signedAt", "uri", "sha256"]);
const STATUSES: ReadonlySet<CertificationStatus> = new Set(["candidate", "certified"]);
const SUBJECT_KINDS: ReadonlySet<CertificationSubjectKind> = new Set(["adapter", "plugin"]);
const ARTIFACT_KINDS: ReadonlySet<EvidenceKind> = new Set([
  "automated-test",
  "model-report",
  "accessibility-report",
  "performance-report",
  "security-report",
  "migration-report",
  "recovery-report",
  "compatibility-report",
  "formal-artifact",
]);
const REQUIREMENTS: ReadonlySet<string> = new Set(PANEFOLD_V1_REQUIREMENT_IDS);
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

function addUnknownFieldIssues(
  input: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: ConformanceIssue[],
): void {
  unknownKeys(input, allowed).forEach((key) => {
    issues.push(
      issue(
        "UNKNOWN_CERTIFICATION_FIELD",
        "invalid",
        `${path}/${key}`,
        `Unknown certification field: ${key}`,
      ),
    );
  });
}

function parseSubject(
  input: unknown,
  path: string,
  issues: ConformanceIssue[],
): CertificationSubject | undefined {
  if (!isPlainRecord(input)) {
    issues.push(
      issue("INVALID_CERTIFICATION_SUBJECT", "invalid", path, "Expected a subject object."),
    );
    return undefined;
  }
  addUnknownFieldIssues(input, SUBJECT_KEYS, path, issues);
  const { kind, id, packageName } = input;
  if (typeof kind !== "string" || !SUBJECT_KINDS.has(kind as CertificationSubjectKind)) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_SUBJECT_KIND",
        "invalid",
        `${path}/kind`,
        "Certification subject must be an adapter or plugin.",
      ),
    );
  }
  if (!isIdentifier(id)) {
    issues.push(
      issue("INVALID_CERTIFICATION_SUBJECT_ID", "invalid", `${path}/id`, "Invalid subject ID."),
    );
  }
  if (
    typeof packageName !== "string" ||
    packageName.length > 214 ||
    !PACKAGE_NAME_PATTERN.test(packageName)
  ) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_PACKAGE_NAME",
        "invalid",
        `${path}/packageName`,
        "Expected a bounded lowercase npm package name.",
      ),
    );
  }
  if (
    typeof kind !== "string" ||
    !SUBJECT_KINDS.has(kind as CertificationSubjectKind) ||
    !isIdentifier(id) ||
    typeof packageName !== "string" ||
    !PACKAGE_NAME_PATTERN.test(packageName)
  ) {
    return undefined;
  }
  return { kind: kind as CertificationSubjectKind, id, packageName };
}

function parseVersions(
  input: unknown,
  path: string,
  issues: ConformanceIssue[],
): CertificationVersions | undefined {
  if (!isPlainRecord(input)) {
    issues.push(
      issue("INVALID_CERTIFICATION_VERSIONS", "invalid", path, "Expected a versions object."),
    );
    return undefined;
  }
  addUnknownFieldIssues(input, VERSION_KEYS, path, issues);
  if (!isSemver(input.subject)) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_SUBJECT_VERSION",
        "invalid",
        `${path}/subject`,
        "Expected an exact semantic version for the adapter or plugin.",
      ),
    );
  }
  if (!isSemver(input.engine)) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_ENGINE_VERSION",
        "invalid",
        `${path}/engine`,
        "Expected an exact Panefold semantic version.",
      ),
    );
  }
  if (!Number.isSafeInteger(input.protocol) || (input.protocol as number) < 1) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_PROTOCOL_VERSION",
        "invalid",
        `${path}/protocol`,
        "Protocol version must be a positive safe integer.",
      ),
    );
  }
  for (const field of ["framework", "browser"] as const) {
    if (input[field] !== undefined && !isBoundedString(input[field])) {
      issues.push(
        issue(
          "INVALID_CERTIFICATION_PLATFORM_VERSION",
          "invalid",
          `${path}/${field}`,
          `${field} version must be a non-empty bounded string when supplied.`,
        ),
      );
    }
  }
  if (
    !isSemver(input.subject) ||
    !isSemver(input.engine) ||
    !Number.isSafeInteger(input.protocol) ||
    (input.protocol as number) < 1
  ) {
    return undefined;
  }
  return {
    subject: input.subject,
    engine: input.engine,
    protocol: input.protocol as number,
    ...(typeof input.framework === "string" ? { framework: input.framework } : {}),
    ...(typeof input.browser === "string" ? { browser: input.browser } : {}),
  };
}

function parseProfile(
  input: unknown,
  path: string,
  issues: ConformanceIssue[],
): CertificationProfile | undefined {
  if (!isPlainRecord(input)) {
    issues.push(
      issue("INVALID_CERTIFICATION_PROFILE", "invalid", path, "Expected a profile object."),
    );
    return undefined;
  }
  addUnknownFieldIssues(input, PROFILE_KEYS, path, issues);
  if (!isIdentifier(input.id)) {
    issues.push(
      issue("INVALID_CERTIFICATION_PROFILE_ID", "invalid", `${path}/id`, "Invalid profile ID."),
    );
  }
  if (!isBoundedString(input.workload)) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_WORKLOAD",
        "invalid",
        `${path}/workload`,
        "A bounded workload description is required.",
      ),
    );
  }
  const surfaces = parseStringArray(input.surfaces, `${path}/surfaces`, issues, {
    allowEmpty: false,
    identifier: true,
  });
  const inputs = parseStringArray(input.inputs, `${path}/inputs`, issues, {
    allowEmpty: false,
    identifier: true,
  });
  if (
    !isIdentifier(input.id) ||
    !isBoundedString(input.workload) ||
    surfaces === undefined ||
    inputs === undefined
  ) {
    return undefined;
  }
  return {
    id: input.id,
    surfaces: [...surfaces].sort(compareCodeUnits),
    inputs: [...inputs].sort(compareCodeUnits),
    workload: input.workload,
  };
}

function parseRequirementIds(
  input: unknown,
  path: string,
  issues: ConformanceIssue[],
): readonly string[] | undefined {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_RECORDS) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_REQUIREMENTS",
        "invalid",
        path,
        `Certification requirements must be a non-empty array of at most ${MAX_RECORDS.toString()} IDs.`,
      ),
    );
    return undefined;
  }
  const parsed: string[] = [];
  const seen = new Set<string>();
  input.forEach((entry, index) => {
    if (!isRequirementId(entry) || !REQUIREMENTS.has(entry)) {
      issues.push(
        issue(
          "UNKNOWN_CERTIFICATION_REQUIREMENT",
          "invalid",
          `${path}/${index.toString()}`,
          `Unknown Panefold requirement: ${String(entry)}`,
        ),
      );
      return;
    }
    if (seen.has(entry)) {
      issues.push(
        issue(
          "DUPLICATE_CERTIFICATION_REQUIREMENT",
          "invalid",
          `${path}/${index.toString()}`,
          `Duplicate certification requirement: ${entry}`,
        ),
      );
      return;
    }
    seen.add(entry);
    parsed.push(entry);
  });
  return parsed;
}

function parseArtifact(
  input: unknown,
  path: string,
  profileId: string | undefined,
  issues: ConformanceIssue[],
): CertificationEvidenceArtifact | undefined {
  if (!isPlainRecord(input)) {
    issues.push(
      issue("INVALID_CERTIFICATION_ARTIFACT", "invalid", path, "Expected an evidence artifact."),
    );
    return undefined;
  }
  addUnknownFieldIssues(input, ARTIFACT_KEYS, path, issues);
  const { id, kind, uri, sha256, producedAt } = input;
  if (!isIdentifier(id)) {
    issues.push(
      issue("INVALID_CERTIFICATION_ARTIFACT_ID", "invalid", `${path}/id`, "Invalid artifact ID."),
    );
  }
  if (typeof kind !== "string" || !ARTIFACT_KINDS.has(kind as EvidenceKind)) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_ARTIFACT_KIND",
        "invalid",
        `${path}/kind`,
        "Certification evidence must be a reproducible result or formal artifact.",
      ),
    );
  }
  if (!isEvidenceUri(uri)) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_ARTIFACT_URI",
        "invalid",
        `${path}/uri`,
        "Invalid evidence URI.",
      ),
    );
  }
  if (!isSha256Digest(sha256)) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_ARTIFACT_HASH",
        "invalid",
        `${path}/sha256`,
        "Expected a lowercase SHA-256 digest.",
      ),
    );
  }
  if (!isRfc3339(producedAt)) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_ARTIFACT_DATE",
        "invalid",
        `${path}/producedAt`,
        "Expected an RFC 3339 production timestamp.",
      ),
    );
  }
  if (input.profileId !== profileId) {
    issues.push(
      issue(
        "CERTIFICATION_ARTIFACT_PROFILE_MISMATCH",
        "invalid",
        `${path}/profileId`,
        "Every artifact must identify the manifest's exact profile.",
      ),
    );
  }
  const requirementIds = parseRequirementIds(
    input.requirementIds,
    `${path}/requirementIds`,
    issues,
  );
  if (
    !isIdentifier(id) ||
    typeof kind !== "string" ||
    !ARTIFACT_KINDS.has(kind as EvidenceKind) ||
    !isEvidenceUri(uri) ||
    !isSha256Digest(sha256) ||
    !isRfc3339(producedAt) ||
    typeof input.profileId !== "string" ||
    input.profileId !== profileId ||
    requirementIds === undefined
  ) {
    return undefined;
  }
  return {
    id,
    kind: kind as EvidenceKind,
    uri,
    sha256,
    producedAt,
    requirementIds: [...requirementIds].sort(compareCodeUnits),
    profileId: input.profileId,
  };
}

function parseApproval(
  input: unknown,
  path: string,
  issues: ConformanceIssue[],
): EvidenceApproval | undefined {
  if (!isPlainRecord(input)) {
    issues.push(
      issue("INVALID_CERTIFICATION_APPROVAL", "invalid", path, "Expected an approval object."),
    );
    return undefined;
  }
  addUnknownFieldIssues(input, APPROVAL_KEYS, path, issues);
  if (!isBoundedString(input.issuer)) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_APPROVAL_ISSUER",
        "invalid",
        `${path}/issuer`,
        "Approval issuer is required.",
      ),
    );
  }
  if (!isRfc3339(input.signedAt)) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_APPROVAL_DATE",
        "invalid",
        `${path}/signedAt`,
        "Expected an RFC 3339 signature timestamp.",
      ),
    );
  }
  if (!isEvidenceUri(input.uri)) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_APPROVAL_URI",
        "invalid",
        `${path}/uri`,
        "Expected an immutable approval URI.",
      ),
    );
  }
  if (!isSha256Digest(input.sha256)) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_APPROVAL_HASH",
        "invalid",
        `${path}/sha256`,
        "Expected a lowercase SHA-256 approval digest.",
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

/**
 * Validates the public third-party adapter/plugin certification interchange format.
 * A candidate proves only that metadata is well-formed. `certified` additionally requires a
 * content-addressed approval that does not predate any referenced result.
 */
export function validateThirdPartyCertificationManifest(
  input: unknown,
): AuditResult<ThirdPartyCertificationManifest> {
  const issues: ConformanceIssue[] = [];
  if (!isPlainRecord(input)) {
    return result<ThirdPartyCertificationManifest>(undefined, [
      issue(
        "INVALID_CERTIFICATION_MANIFEST",
        "invalid",
        "",
        "Expected a plain certification manifest.",
      ),
    ]);
  }
  addUnknownFieldIssues(input, MANIFEST_KEYS, "", issues);
  if (input.$schema !== undefined && !isBoundedString(input.$schema)) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_SCHEMA_URI",
        "invalid",
        "/$schema",
        "Schema URI must be a bounded string.",
      ),
    );
  }
  if (input.schemaVersion !== 1) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_SCHEMA_VERSION",
        "invalid",
        "/schemaVersion",
        "Only certification schema version 1 is supported.",
      ),
    );
  }
  if (!isIdentifier(input.certificationId)) {
    issues.push(
      issue("INVALID_CERTIFICATION_ID", "invalid", "/certificationId", "Invalid certification ID."),
    );
  }
  if (typeof input.status !== "string" || !STATUSES.has(input.status as CertificationStatus)) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_STATUS",
        "invalid",
        "/status",
        "Certification status must be candidate or certified.",
      ),
    );
  }
  const subject = parseSubject(input.subject, "/subject", issues);
  const versions = parseVersions(input.versions, "/versions", issues);
  const profile = parseProfile(input.profile, "/profile", issues);
  const approval =
    input.approval === undefined ? undefined : parseApproval(input.approval, "/approval", issues);

  const evidence: CertificationEvidenceArtifact[] = [];
  if (
    !Array.isArray(input.evidence) ||
    input.evidence.length === 0 ||
    input.evidence.length > MAX_RECORDS
  ) {
    issues.push(
      issue(
        "INVALID_CERTIFICATION_EVIDENCE",
        "invalid",
        "/evidence",
        `Certification evidence must contain 1 to ${MAX_RECORDS.toString()} artifacts.`,
      ),
    );
  } else {
    const ids = new Set<string>();
    input.evidence.forEach((entry, index) => {
      const artifact = parseArtifact(entry, `/evidence/${index.toString()}`, profile?.id, issues);
      if (artifact === undefined) return;
      if (ids.has(artifact.id)) {
        issues.push(
          issue(
            "DUPLICATE_CERTIFICATION_ARTIFACT",
            "invalid",
            `/evidence/${index.toString()}/id`,
            `Duplicate certification artifact: ${artifact.id}`,
          ),
        );
        return;
      }
      ids.add(artifact.id);
      evidence.push(artifact);
    });
  }

  if (input.status === "certified" && approval === undefined) {
    issues.push(
      issue(
        "CERTIFICATION_WITHOUT_APPROVAL",
        "invalid",
        "/approval",
        "A certified manifest requires a content-addressed signed approval.",
      ),
    );
  }
  if (input.status === "candidate" && input.approval !== undefined) {
    issues.push(
      issue(
        "CANDIDATE_HAS_APPROVAL",
        "invalid",
        "/approval",
        "A manifest with approval must use certified status.",
      ),
    );
  }
  const evidenceDates = Array.isArray(input.evidence)
    ? input.evidence.flatMap((entry) =>
        isPlainRecord(entry) && isRfc3339(entry.producedAt) ? [entry.producedAt] : [],
      )
    : [];
  if (
    approval !== undefined &&
    evidenceDates.some((producedAt) => Date.parse(producedAt) > Date.parse(approval.signedAt))
  ) {
    issues.push(
      issue(
        "APPROVAL_PREDATES_EVIDENCE",
        "invalid",
        "/approval/signedAt",
        "Approval cannot predate an artifact that it attests.",
      ),
    );
  }

  if (
    input.schemaVersion !== 1 ||
    !isIdentifier(input.certificationId) ||
    typeof input.status !== "string" ||
    !STATUSES.has(input.status as CertificationStatus) ||
    subject === undefined ||
    versions === undefined ||
    profile === undefined ||
    !Array.isArray(input.evidence) ||
    evidence.length !== input.evidence.length
  ) {
    return result<ThirdPartyCertificationManifest>(undefined, issues);
  }

  return result(
    {
      schemaVersion: 1,
      certificationId: input.certificationId,
      status: input.status as CertificationStatus,
      subject,
      versions,
      profile,
      evidence: evidence.sort((left, right) => compareCodeUnits(left.id, right.id)),
      ...(typeof input.$schema === "string" ? { $schema: input.$schema } : {}),
      ...(approval === undefined ? {} : { approval }),
    },
    issues,
  );
}
