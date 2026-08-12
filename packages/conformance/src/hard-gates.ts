import {
  compareCodeUnits,
  isBoundedString,
  isPlainRecord,
  isRequirementId,
  issue,
  MAX_RECORDS,
  parseStringArray,
  sortIssues,
  unknownKeys,
} from "./internal";
import type {
  ConformanceIssue,
  EvidenceRecord,
  EvidenceStatus,
  EvidenceVerificationClass,
  HardGateAuditContext,
  HardGateAuditReport,
  HardGateId,
  HardGateRecord,
} from "./types";

export const HARD_GATE_IDS = [
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
] as const satisfies readonly HardGateId[];

const GATE_KEYS = new Set([
  "id",
  "status",
  "requirementIds",
  "profileIds",
  "requiredEvidenceClasses",
  "evidenceIds",
  "blockedBy",
  "note",
]);
const GATE_ID_SET: ReadonlySet<string> = new Set(HARD_GATE_IDS);
const STATUSES: ReadonlySet<EvidenceStatus> = new Set(["verified", "unresolved", "blocked"]);
const EVIDENCE_CLASSES: ReadonlySet<EvidenceVerificationClass> = new Set([
  "code-verifiable",
  "environment-verifiable",
  "manual-external",
]);

function parseRequirementIds(
  input: unknown,
  path: string,
  issues: ConformanceIssue[],
): readonly string[] | undefined {
  if (!Array.isArray(input) || input.length > MAX_RECORDS) {
    issues.push(
      issue(
        "INVALID_HARD_GATE_REQUIREMENTS",
        "invalid",
        path,
        `Hard-gate requirements must be an array of at most ${MAX_RECORDS.toString()} IDs.`,
      ),
    );
    return undefined;
  }
  const parsed: string[] = [];
  const seen = new Set<string>();
  input.forEach((entry, index) => {
    if (!isRequirementId(entry)) {
      issues.push(
        issue(
          "INVALID_HARD_GATE_REQUIREMENT",
          "invalid",
          `${path}/${index.toString()}`,
          "Expected an Appendix A requirement ID.",
        ),
      );
      return;
    }
    if (seen.has(entry)) {
      issues.push(
        issue(
          "DUPLICATE_HARD_GATE_REQUIREMENT",
          "invalid",
          `${path}/${index.toString()}`,
          `Duplicate hard-gate requirement: ${entry}`,
        ),
      );
      return;
    }
    seen.add(entry);
    parsed.push(entry);
  });
  if (parsed.length === 0) {
    issues.push(
      issue(
        "HARD_GATE_WITHOUT_REQUIREMENT_SCOPE",
        "invalid",
        path,
        "Every hard gate must identify the normative requirements that it closes.",
      ),
    );
  }
  return parsed;
}

function parseEvidenceClasses(
  input: unknown,
  path: string,
  issues: ConformanceIssue[],
): readonly EvidenceVerificationClass[] | undefined {
  if (!Array.isArray(input) || input.length > MAX_RECORDS) {
    issues.push(
      issue(
        "INVALID_HARD_GATE_EVIDENCE_CLASSES",
        "invalid",
        path,
        "Hard-gate evidence classes must be an array.",
      ),
    );
    return undefined;
  }
  const parsed: EvidenceVerificationClass[] = [];
  const seen = new Set<string>();
  input.forEach((entry, index) => {
    if (typeof entry !== "string" || !EVIDENCE_CLASSES.has(entry as EvidenceVerificationClass)) {
      issues.push(
        issue(
          "INVALID_HARD_GATE_EVIDENCE_CLASS",
          "invalid",
          `${path}/${index.toString()}`,
          "Hard gates may require code-verifiable, environment-verifiable, or manual-external evidence.",
        ),
      );
      return;
    }
    if (seen.has(entry)) {
      issues.push(
        issue(
          "DUPLICATE_HARD_GATE_EVIDENCE_CLASS",
          "invalid",
          `${path}/${index.toString()}`,
          `Duplicate hard-gate evidence class: ${entry}`,
        ),
      );
      return;
    }
    seen.add(entry);
    parsed.push(entry as EvidenceVerificationClass);
  });
  if (parsed.length === 0) {
    issues.push(
      issue(
        "HARD_GATE_WITHOUT_EVIDENCE_CLASS",
        "invalid",
        path,
        "Every hard gate must declare its minimum classes of passing evidence.",
      ),
    );
  }
  return parsed;
}

function parseGate(
  input: unknown,
  path: string,
  issues: ConformanceIssue[],
): HardGateRecord | undefined {
  if (!isPlainRecord(input)) {
    issues.push(issue("INVALID_HARD_GATE", "invalid", path, "Expected a plain hard-gate record."));
    return undefined;
  }
  unknownKeys(input, GATE_KEYS).forEach((key) => {
    issues.push(
      issue("UNKNOWN_HARD_GATE_FIELD", "invalid", `${path}/${key}`, `Unknown field: ${key}`),
    );
  });
  const id = input.id;
  const status = input.status;
  if (typeof id !== "string" || !GATE_ID_SET.has(id)) {
    issues.push(
      issue("UNKNOWN_HARD_GATE", "invalid", `${path}/id`, `Unknown hard gate: ${String(id)}`),
    );
  }
  if (typeof status !== "string" || !STATUSES.has(status as EvidenceStatus)) {
    issues.push(
      issue("INVALID_HARD_GATE_STATUS", "invalid", `${path}/status`, "Invalid gate status."),
    );
  }
  const requirementIds = parseRequirementIds(
    input.requirementIds,
    `${path}/requirementIds`,
    issues,
  );
  const profileIds = parseStringArray(input.profileIds, `${path}/profileIds`, issues, {
    allowEmpty: false,
    identifier: true,
  });
  const requiredEvidenceClasses = parseEvidenceClasses(
    input.requiredEvidenceClasses,
    `${path}/requiredEvidenceClasses`,
    issues,
  );
  const evidenceIds = parseStringArray(input.evidenceIds, `${path}/evidenceIds`, issues, {
    identifier: true,
  });
  const blockedBy =
    input.blockedBy === undefined
      ? undefined
      : parseStringArray(input.blockedBy, `${path}/blockedBy`, issues, { allowEmpty: false });
  if (input.note !== undefined && !isBoundedString(input.note)) {
    issues.push(issue("INVALID_HARD_GATE_NOTE", "invalid", `${path}/note`, "Invalid gate note."));
  }
  if (
    typeof id !== "string" ||
    !GATE_ID_SET.has(id) ||
    typeof status !== "string" ||
    !STATUSES.has(status as EvidenceStatus) ||
    requirementIds === undefined ||
    profileIds === undefined ||
    requiredEvidenceClasses === undefined ||
    evidenceIds === undefined
  ) {
    return undefined;
  }
  return {
    id: id as HardGateId,
    status: status as EvidenceStatus,
    requirementIds: [...requirementIds].sort(compareCodeUnits),
    profileIds: [...profileIds].sort(compareCodeUnits),
    requiredEvidenceClasses: [...requiredEvidenceClasses].sort(compareCodeUnits),
    evidenceIds: [...evidenceIds].sort(compareCodeUnits),
    ...(blockedBy === undefined ? {} : { blockedBy }),
    ...(typeof input.note === "string" ? { note: input.note } : {}),
  };
}

function traceKey(requirementId: string, profileId: string): string {
  return `${requirementId}@${profileId}`;
}

function auditVerifiedGate(
  gate: HardGateRecord,
  evidenceById: ReadonlyMap<string, EvidenceRecord>,
  context: HardGateAuditContext | undefined,
  issues: ConformanceIssue[],
): void {
  const path = `/hardGates/${gate.id}`;
  if (gate.evidenceIds.length === 0) {
    issues.push(
      issue(
        "VERIFIED_HARD_GATE_WITHOUT_EVIDENCE",
        "invalid",
        `${path}/evidenceIds`,
        "A verified hard gate requires evidence artifacts.",
      ),
    );
  }

  gate.requiredEvidenceClasses.forEach((verificationClass) => {
    gate.profileIds.forEach((profileId) => {
      const supported = gate.evidenceIds.some((evidenceId) => {
        const record = evidenceById.get(evidenceId);
        return (
          record?.status === "verified" &&
          record.verificationClass === verificationClass &&
          record.profileIds.includes(profileId) &&
          record.requirementIds.some((requirementId) => gate.requirementIds.includes(requirementId))
        );
      });
      if (!supported) {
        issues.push(
          issue(
            "VERIFIED_HARD_GATE_LACKS_REQUIRED_EVIDENCE_CLASS",
            "invalid",
            `${path}/requiredEvidenceClasses`,
            `Gate lacks verified ${verificationClass} evidence for profile ${profileId}.`,
          ),
        );
      }
    });
  });

  if (context === undefined) return;
  const traces = new Map(
    context.traces.map((trace) => [traceKey(trace.requirementId, trace.profileId), trace] as const),
  );
  gate.requirementIds.forEach((requirementId) => {
    gate.profileIds.forEach((profileId) => {
      const key = traceKey(requirementId, profileId);
      const trace = traces.get(key);
      if (trace === undefined) {
        issues.push(
          issue(
            "VERIFIED_HARD_GATE_MISSING_TRACE",
            "invalid",
            `${path}/requirementIds`,
            `Verified gate has no trace for ${key}.`,
          ),
        );
      } else if (trace.status !== "verified" && trace.status !== "not-applicable") {
        issues.push(
          issue(
            "VERIFIED_HARD_GATE_HAS_OPEN_TRACE",
            "invalid",
            `${path}/requirementIds`,
            `Verified gate contains a ${trace.status} requirement trace: ${key}.`,
          ),
        );
      }
    });
  });
}

function auditGateScope(
  gate: HardGateRecord,
  evidenceById: ReadonlyMap<string, EvidenceRecord>,
  context: HardGateAuditContext | undefined,
  issues: ConformanceIssue[],
): void {
  const path = `/hardGates/${gate.id}`;
  const expectedRequirements = new Set(context?.expectedRequirementIds ?? []);
  const publishedProfiles = new Set(context?.profileIds ?? []);
  if (context !== undefined) {
    gate.requirementIds.forEach((requirementId) => {
      if (!expectedRequirements.has(requirementId)) {
        issues.push(
          issue(
            "HARD_GATE_REFERENCES_UNKNOWN_REQUIREMENT",
            "invalid",
            `${path}/requirementIds`,
            `Hard gate references an unknown requirement: ${requirementId}`,
          ),
        );
      }
    });
    gate.profileIds.forEach((profileId) => {
      if (!publishedProfiles.has(profileId)) {
        issues.push(
          issue(
            "HARD_GATE_REFERENCES_UNKNOWN_PROFILE",
            "invalid",
            `${path}/profileIds`,
            `Hard gate references an unpublished profile: ${profileId}`,
          ),
        );
      }
    });
  }

  gate.evidenceIds.forEach((evidenceId) => {
    const record = evidenceById.get(evidenceId);
    if (record === undefined) {
      issues.push(
        issue(
          "UNKNOWN_HARD_GATE_EVIDENCE",
          "invalid",
          `${path}/evidenceIds`,
          `Hard gate references unknown evidence: ${evidenceId}`,
        ),
      );
      return;
    }
    if (gate.status === "verified" && record.status !== "verified") {
      issues.push(
        issue(
          "VERIFIED_HARD_GATE_USES_UNVERIFIED_EVIDENCE",
          "invalid",
          `${path}/evidenceIds`,
          `Hard gate claims verification from ${record.status} evidence: ${evidenceId}`,
        ),
      );
    }
    if (
      !record.requirementIds.some((requirementId) => gate.requirementIds.includes(requirementId))
    ) {
      issues.push(
        issue(
          "HARD_GATE_EVIDENCE_REQUIREMENT_MISMATCH",
          "invalid",
          `${path}/evidenceIds`,
          `Evidence ${evidenceId} does not cover any requirement in gate ${gate.id}.`,
        ),
      );
    }
    if (!record.profileIds.some((profileId) => gate.profileIds.includes(profileId))) {
      issues.push(
        issue(
          "HARD_GATE_EVIDENCE_PROFILE_MISMATCH",
          "invalid",
          `${path}/evidenceIds`,
          `Evidence ${evidenceId} does not cover any profile in gate ${gate.id}.`,
        ),
      );
    }
  });
}

export function auditHardGates(
  input: readonly unknown[],
  evidence: readonly EvidenceRecord[],
  context?: HardGateAuditContext,
): HardGateAuditReport {
  const issues: ConformanceIssue[] = [];
  const gates: HardGateRecord[] = [];
  const seen = new Set<string>();
  const unknownGateIds: string[] = [];
  if (input.length > MAX_RECORDS) {
    issues.push(
      issue(
        "HARD_GATE_LIMIT_EXCEEDED",
        "invalid",
        "/hardGates",
        `Hard-gate records exceed ${MAX_RECORDS.toString()} entries.`,
      ),
    );
  } else {
    input.forEach((entry, index) => {
      if (isPlainRecord(entry) && typeof entry.id === "string" && !GATE_ID_SET.has(entry.id)) {
        unknownGateIds.push(entry.id);
      }
      const gate = parseGate(entry, `/hardGates/${index.toString()}`, issues);
      if (gate === undefined) return;
      if (seen.has(gate.id)) {
        issues.push(
          issue(
            "DUPLICATE_HARD_GATE",
            "invalid",
            `/hardGates/${index.toString()}/id`,
            `Duplicate hard gate: ${gate.id}`,
          ),
        );
        return;
      }
      seen.add(gate.id);
      gates.push(gate);
    });
  }

  const evidenceById = new Map(evidence.map((entry) => [entry.id, entry] as const));
  gates.forEach((gate) => {
    const path = `/hardGates/${gate.id}`;
    auditGateScope(gate, evidenceById, context, issues);
    if (gate.status === "verified") auditVerifiedGate(gate, evidenceById, context, issues);
    if (gate.status === "blocked") {
      if (gate.blockedBy === undefined || gate.blockedBy.length === 0) {
        issues.push(
          issue(
            "BLOCKED_HARD_GATE_WITHOUT_BLOCKER",
            "invalid",
            `${path}/blockedBy`,
            "A blocked hard gate must identify at least one blocker.",
          ),
        );
      }
      issues.push(
        issue("HARD_GATE_BLOCKED", "blocked", path, `Hard gate remains blocked: ${gate.id}`),
      );
    }
    if (gate.status === "unresolved") {
      if (!isBoundedString(gate.note)) {
        issues.push(
          issue(
            "UNRESOLVED_HARD_GATE_WITHOUT_NOTE",
            "invalid",
            `${path}/note`,
            "An unresolved hard gate must explain what evidence is missing.",
          ),
        );
      }
      issues.push(
        issue(
          "HARD_GATE_UNRESOLVED",
          "unresolved",
          path,
          `Hard gate remains unresolved: ${gate.id}`,
        ),
      );
    }
  });

  const missingGateIds = HARD_GATE_IDS.filter((id) => !seen.has(id));
  if (missingGateIds.length > 0) {
    issues.push(
      issue(
        "HARD_GATES_INCOMPLETE",
        "unresolved",
        "/hardGates",
        `${missingGateIds.length.toString()} hard gate(s) have no explicit status: ${missingGateIds.join(", ")}`,
      ),
    );
  }

  return {
    expectedGateIds: HARD_GATE_IDS,
    gates: gates.sort((left, right) => compareCodeUnits(left.id, right.id)),
    missingGateIds,
    unknownGateIds: [...new Set(unknownGateIds)].sort(compareCodeUnits),
    issues: sortIssues(issues),
  };
}
