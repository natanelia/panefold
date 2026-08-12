import {
  compareCodeUnits,
  isBoundedString,
  isPlainRecord,
  isRequirementId,
  issue,
  MAX_RECORDS,
  parseStringArray,
  sortIssues,
  sortedUnique,
  unknownKeys,
} from "./internal";
import { PANEFOLD_V1_REQUIREMENT_IDS } from "./requirements";
import type {
  ConformanceIssue,
  EvidenceRecord,
  RequirementApplicability,
  RequirementDefinition,
  RequirementLevel,
  RequirementTrace,
  RequirementTraceabilityInput,
  RequirementTraceabilityReport,
  TraceStatus,
} from "./types";

const REQUIREMENT_KEYS = new Set([
  "id",
  "level",
  "applicability",
  "statement",
  "acceptanceEvidence",
]);
const TRACE_KEYS = new Set(["requirementId", "profileId", "status", "evidenceIds", "rationale"]);
const REQUIREMENT_LEVELS: ReadonlySet<RequirementLevel> = new Set([
  "MUST",
  "MUST NOT",
  "SHOULD",
  "SHOULD NOT",
]);
const APPLICABILITY: ReadonlySet<RequirementApplicability> = new Set([
  "universal",
  "profile-scoped",
]);
const TRACE_STATUSES: ReadonlySet<TraceStatus> = new Set([
  "verified",
  "unresolved",
  "blocked",
  "not-applicable",
]);

function parseRequirement(
  input: unknown,
  path: string,
  issues: ConformanceIssue[],
): RequirementDefinition | undefined {
  if (!isPlainRecord(input)) {
    issues.push(
      issue("INVALID_REQUIREMENT", "invalid", path, "Expected a plain requirement record."),
    );
    return undefined;
  }
  unknownKeys(input, REQUIREMENT_KEYS).forEach((key) => {
    issues.push(
      issue("UNKNOWN_REQUIREMENT_FIELD", "invalid", `${path}/${key}`, `Unknown field: ${key}`),
    );
  });
  const id = input.id;
  const level = input.level;
  const applicability = input.applicability;
  if (!isRequirementId(id)) {
    issues.push(
      issue(
        "INVALID_REQUIREMENT_ID",
        "invalid",
        `${path}/id`,
        "Expected an Appendix A requirement ID such as SYS-001.",
      ),
    );
  }
  if (typeof level !== "string" || !REQUIREMENT_LEVELS.has(level as RequirementLevel)) {
    issues.push(
      issue("INVALID_REQUIREMENT_LEVEL", "invalid", `${path}/level`, "Invalid normative level."),
    );
  }
  if (
    typeof applicability !== "string" ||
    !APPLICABILITY.has(applicability as RequirementApplicability)
  ) {
    issues.push(
      issue(
        "INVALID_REQUIREMENT_APPLICABILITY",
        "invalid",
        `${path}/applicability`,
        "Applicability must be universal or profile-scoped.",
      ),
    );
  }
  if (input.statement !== undefined && !isBoundedString(input.statement)) {
    issues.push(
      issue("INVALID_REQUIREMENT_STATEMENT", "invalid", `${path}/statement`, "Invalid statement."),
    );
  }
  if (input.acceptanceEvidence !== undefined && !isBoundedString(input.acceptanceEvidence)) {
    issues.push(
      issue(
        "INVALID_ACCEPTANCE_EVIDENCE",
        "invalid",
        `${path}/acceptanceEvidence`,
        "Invalid acceptance-evidence description.",
      ),
    );
  }
  if (
    !isRequirementId(id) ||
    typeof level !== "string" ||
    !REQUIREMENT_LEVELS.has(level as RequirementLevel) ||
    typeof applicability !== "string" ||
    !APPLICABILITY.has(applicability as RequirementApplicability)
  ) {
    return undefined;
  }
  return {
    id,
    level: level as RequirementLevel,
    applicability: applicability as RequirementApplicability,
    ...(typeof input.statement === "string" ? { statement: input.statement } : {}),
    ...(typeof input.acceptanceEvidence === "string"
      ? { acceptanceEvidence: input.acceptanceEvidence }
      : {}),
  };
}

function parseTrace(
  input: unknown,
  path: string,
  issues: ConformanceIssue[],
): RequirementTrace | undefined {
  if (!isPlainRecord(input)) {
    issues.push(issue("INVALID_TRACE", "invalid", path, "Expected a plain trace record."));
    return undefined;
  }
  unknownKeys(input, TRACE_KEYS).forEach((key) => {
    issues.push(issue("UNKNOWN_TRACE_FIELD", "invalid", `${path}/${key}`, `Unknown field: ${key}`));
  });
  const requirementId = input.requirementId;
  const profileId = input.profileId;
  const status = input.status;
  if (!isRequirementId(requirementId)) {
    issues.push(
      issue(
        "INVALID_TRACE_REQUIREMENT",
        "invalid",
        `${path}/requirementId`,
        "Invalid requirement ID.",
      ),
    );
  }
  if (typeof profileId !== "string" || profileId.length === 0) {
    issues.push(
      issue("INVALID_TRACE_PROFILE", "invalid", `${path}/profileId`, "Profile ID is required."),
    );
  }
  if (typeof status !== "string" || !TRACE_STATUSES.has(status as TraceStatus)) {
    issues.push(
      issue("INVALID_TRACE_STATUS", "invalid", `${path}/status`, "Invalid trace status."),
    );
  }
  const evidenceIds = parseStringArray(input.evidenceIds, `${path}/evidenceIds`, issues, {
    identifier: true,
  });
  if (input.rationale !== undefined && !isBoundedString(input.rationale)) {
    issues.push(
      issue("INVALID_TRACE_RATIONALE", "invalid", `${path}/rationale`, "Invalid rationale."),
    );
  }
  if (
    !isRequirementId(requirementId) ||
    typeof profileId !== "string" ||
    profileId.length === 0 ||
    typeof status !== "string" ||
    !TRACE_STATUSES.has(status as TraceStatus) ||
    evidenceIds === undefined
  ) {
    return undefined;
  }
  return {
    requirementId,
    profileId,
    status: status as TraceStatus,
    evidenceIds: [...evidenceIds].sort(compareCodeUnits),
    ...(typeof input.rationale === "string" ? { rationale: input.rationale } : {}),
  };
}

function traceKey(requirementId: string, profileId: string): string {
  return `${requirementId}@${profileId}`;
}

function auditTraceEvidence(
  trace: RequirementTrace,
  definition: RequirementDefinition | undefined,
  evidenceById: ReadonlyMap<string, EvidenceRecord>,
  issues: ConformanceIssue[],
): void {
  const path = `/traces/${traceKey(trace.requirementId, trace.profileId)}`;
  if (trace.status === "verified" && trace.evidenceIds.length === 0) {
    issues.push(
      issue(
        "VERIFIED_TRACE_WITHOUT_EVIDENCE",
        "invalid",
        `${path}/evidenceIds`,
        "A verified trace requires at least one evidence artifact.",
      ),
    );
  }
  trace.evidenceIds.forEach((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    if (evidence === undefined) {
      issues.push(
        issue(
          "UNKNOWN_TRACE_EVIDENCE",
          "invalid",
          `${path}/evidenceIds`,
          `Trace references unknown evidence: ${evidenceId}`,
        ),
      );
      return;
    }
    if (trace.status === "verified" && evidence.status !== "verified") {
      issues.push(
        issue(
          "VERIFIED_TRACE_USES_UNVERIFIED_EVIDENCE",
          "invalid",
          `${path}/evidenceIds`,
          `Trace claims verification from ${evidence.status} evidence: ${evidenceId}`,
        ),
      );
    }
    if (!evidence.requirementIds.includes(trace.requirementId)) {
      issues.push(
        issue(
          "EVIDENCE_REQUIREMENT_MISMATCH",
          "invalid",
          `${path}/evidenceIds`,
          `Evidence ${evidenceId} does not cover ${trace.requirementId}.`,
        ),
      );
    }
    if (!evidence.profileIds.includes(trace.profileId)) {
      issues.push(
        issue(
          "EVIDENCE_TRACE_PROFILE_MISMATCH",
          "invalid",
          `${path}/evidenceIds`,
          `Evidence ${evidenceId} does not cover ${trace.profileId}.`,
        ),
      );
    }
  });

  if (trace.status === "blocked") {
    if (!isBoundedString(trace.rationale)) {
      issues.push(
        issue(
          "BLOCKED_TRACE_WITHOUT_RATIONALE",
          "invalid",
          `${path}/rationale`,
          "A blocked trace must identify the blocker.",
        ),
      );
    }
    issues.push(
      issue(
        "REQUIREMENT_BLOCKED",
        "blocked",
        path,
        `Requirement remains blocked: ${trace.requirementId}`,
      ),
    );
  }
  if (trace.status === "unresolved") {
    if (!isBoundedString(trace.rationale)) {
      issues.push(
        issue(
          "UNRESOLVED_TRACE_WITHOUT_RATIONALE",
          "invalid",
          `${path}/rationale`,
          "An unresolved trace must explain what evidence is missing.",
        ),
      );
    }
    issues.push(
      issue(
        "REQUIREMENT_UNRESOLVED",
        "unresolved",
        path,
        `Requirement remains unresolved: ${trace.requirementId}`,
      ),
    );
  }
  if (trace.status === "not-applicable") {
    if (!isBoundedString(trace.rationale)) {
      issues.push(
        issue(
          "NOT_APPLICABLE_WITHOUT_RATIONALE",
          "invalid",
          `${path}/rationale`,
          "A not-applicable trace must explain the published profile boundary.",
        ),
      );
    }
    if (definition === undefined) {
      issues.push(
        issue(
          "NOT_APPLICABLE_WITHOUT_DEFINITION",
          "unresolved",
          path,
          "Applicability cannot be checked until the requirement definition is present.",
        ),
      );
    } else if (definition.applicability === "universal") {
      issues.push(
        issue(
          "UNIVERSAL_REQUIREMENT_MARKED_NOT_APPLICABLE",
          "invalid",
          path,
          "A universal requirement cannot be removed from a profile claim.",
        ),
      );
    }
  }
}

export function auditRequirementTraceability(
  input: RequirementTraceabilityInput,
): RequirementTraceabilityReport {
  const issues: ConformanceIssue[] = [];
  const expectedInput = input.expectedRequirementIds ?? PANEFOLD_V1_REQUIREMENT_IDS;
  if (expectedInput.length === 0) {
    issues.push(
      issue(
        "EMPTY_REQUIREMENT_INVENTORY",
        "invalid",
        "/requirements/expected",
        "An empty authoritative requirement inventory cannot establish conformance.",
      ),
    );
  }
  const invalidExpected = expectedInput.filter((id) => !isRequirementId(id));
  invalidExpected.forEach((id) => {
    issues.push(
      issue(
        "INVALID_EXPECTED_REQUIREMENT_ID",
        "invalid",
        "/requirements/expected",
        `Invalid expected requirement ID: ${id}`,
      ),
    );
  });
  const expectedRequirementIds = sortedUnique(
    expectedInput.filter((id): id is string => isRequirementId(id)),
  );
  if (expectedRequirementIds.length !== expectedInput.length - invalidExpected.length) {
    issues.push(
      issue(
        "DUPLICATE_EXPECTED_REQUIREMENT_ID",
        "invalid",
        "/requirements/expected",
        "The expected requirement inventory contains duplicate IDs.",
      ),
    );
  }
  const expected = new Set(expectedRequirementIds);

  const definitions: RequirementDefinition[] = [];
  const definitionById = new Map<string, RequirementDefinition>();
  if (input.requirements.length > MAX_RECORDS) {
    issues.push(
      issue(
        "REQUIREMENT_LIMIT_EXCEEDED",
        "invalid",
        "/requirements",
        `Requirement definitions exceed ${MAX_RECORDS.toString()} entries.`,
      ),
    );
  } else {
    input.requirements.forEach((entry, index) => {
      const definition = parseRequirement(entry, `/requirements/${index.toString()}`, issues);
      if (definition === undefined) return;
      if (definitionById.has(definition.id)) {
        issues.push(
          issue(
            "DUPLICATE_REQUIREMENT_DEFINITION",
            "invalid",
            `/requirements/${index.toString()}/id`,
            `Duplicate requirement definition: ${definition.id}`,
          ),
        );
        return;
      }
      definitionById.set(definition.id, definition);
      definitions.push(definition);
    });
  }

  const definedRequirementIds = sortedUnique(definitions.map((entry) => entry.id));
  const missingRequirementIds = expectedRequirementIds.filter((id) => !definitionById.has(id));
  const unknownRequirementIds = definedRequirementIds.filter((id) => !expected.has(id));
  if (missingRequirementIds.length > 0) {
    issues.push(
      issue(
        "REQUIREMENT_DEFINITIONS_INCOMPLETE",
        "unresolved",
        "/requirements",
        `${missingRequirementIds.length.toString()} authoritative requirement definition(s) are missing.`,
      ),
    );
  }
  unknownRequirementIds.forEach((id) => {
    issues.push(
      issue(
        "UNKNOWN_REQUIREMENT_DEFINITION",
        "invalid",
        "/requirements",
        `Requirement ID is not in the authoritative design inventory: ${id}`,
      ),
    );
  });

  const profileIds = new Set(input.profiles.map((profile) => profile.id));
  const evidenceById = new Map(input.evidence.map((entry) => [entry.id, entry] as const));
  const traces: RequirementTrace[] = [];
  const traceKeys = new Set<string>();
  if (input.traces.length > MAX_RECORDS) {
    issues.push(
      issue(
        "TRACE_LIMIT_EXCEEDED",
        "invalid",
        "/traces",
        `Trace records exceed ${MAX_RECORDS.toString()} entries.`,
      ),
    );
  } else {
    input.traces.forEach((entry, index) => {
      const trace = parseTrace(entry, `/traces/${index.toString()}`, issues);
      if (trace === undefined) return;
      const key = traceKey(trace.requirementId, trace.profileId);
      if (traceKeys.has(key)) {
        issues.push(
          issue(
            "DUPLICATE_REQUIREMENT_TRACE",
            "invalid",
            `/traces/${index.toString()}`,
            `Duplicate trace: ${key}`,
          ),
        );
        return;
      }
      traceKeys.add(key);
      traces.push(trace);
      if (!expected.has(trace.requirementId)) {
        issues.push(
          issue(
            "TRACE_REFERENCES_UNKNOWN_REQUIREMENT",
            "invalid",
            `/traces/${index.toString()}/requirementId`,
            `Trace references a requirement outside the authoritative inventory: ${trace.requirementId}`,
          ),
        );
      }
      if (!profileIds.has(trace.profileId)) {
        issues.push(
          issue(
            "TRACE_REFERENCES_UNKNOWN_PROFILE",
            "invalid",
            `/traces/${index.toString()}/profileId`,
            `Trace references an unpublished profile: ${trace.profileId}`,
          ),
        );
      }
      auditTraceEvidence(trace, definitionById.get(trace.requirementId), evidenceById, issues);
    });
  }

  const missingTraceKeys: string[] = [];
  expectedRequirementIds.forEach((requirementId) => {
    input.profiles.forEach((profile) => {
      const key = traceKey(requirementId, profile.id);
      if (!traceKeys.has(key)) missingTraceKeys.push(key);
    });
  });
  missingTraceKeys.sort(compareCodeUnits);
  if (missingTraceKeys.length > 0) {
    issues.push(
      issue(
        "REQUIREMENT_TRACES_INCOMPLETE",
        "unresolved",
        "/traces",
        `${missingTraceKeys.length.toString()} requirement/profile trace(s) are missing.`,
      ),
    );
  }

  return {
    expectedRequirementIds,
    definedRequirementIds,
    missingRequirementIds,
    unknownRequirementIds,
    missingTraceKeys,
    traces: traces.sort((left, right) =>
      compareCodeUnits(
        traceKey(left.requirementId, left.profileId),
        traceKey(right.requirementId, right.profileId),
      ),
    ),
    issues: sortIssues(issues),
  };
}
