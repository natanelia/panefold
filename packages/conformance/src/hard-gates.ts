import {
  compareCodeUnits,
  isBoundedString,
  isPlainRecord,
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

const GATE_KEYS = new Set(["id", "status", "evidenceIds", "blockedBy", "note"]);
const GATE_ID_SET: ReadonlySet<string> = new Set(HARD_GATE_IDS);
const STATUSES: ReadonlySet<EvidenceStatus> = new Set(["verified", "unresolved", "blocked"]);

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
    evidenceIds === undefined
  ) {
    return undefined;
  }
  return {
    id: id as HardGateId,
    status: status as EvidenceStatus,
    evidenceIds: [...evidenceIds].sort(compareCodeUnits),
    ...(blockedBy === undefined ? {} : { blockedBy }),
    ...(typeof input.note === "string" ? { note: input.note } : {}),
  };
}

export function auditHardGates(
  input: readonly unknown[],
  evidence: readonly EvidenceRecord[],
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
    if (gate.status === "verified" && gate.evidenceIds.length === 0) {
      issues.push(
        issue(
          "VERIFIED_HARD_GATE_WITHOUT_EVIDENCE",
          "invalid",
          `${path}/evidenceIds`,
          "A verified hard gate requires at least one evidence artifact.",
        ),
      );
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
      } else if (gate.status === "verified" && record.status !== "verified") {
        issues.push(
          issue(
            "VERIFIED_HARD_GATE_USES_UNVERIFIED_EVIDENCE",
            "invalid",
            `${path}/evidenceIds`,
            `Hard gate claims verification from ${record.status} evidence: ${evidenceId}`,
          ),
        );
      }
    });
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
