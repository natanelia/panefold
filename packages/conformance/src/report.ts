import { auditCommandRegistry } from "./commands";
import { validateEvidenceRecords } from "./evidence";
import { auditHardGates } from "./hard-gates";
import {
  compareCodeUnits,
  countByDisposition,
  isPlainRecord,
  isRfc3339,
  issue,
  sortIssues,
} from "./internal";
import { validateConformanceManifest } from "./manifest";
import { PANEFOLD_V1_REQUIREMENT_IDS } from "./requirements";
import { auditSupportClaims } from "./support";
import { auditRequirementTraceability } from "./traceability";
import type {
  ConformanceIssue,
  ConformanceReport,
  ConformanceReportInput,
  ConformanceReportStatus,
  EvidenceRecord,
  EvidenceStatus,
} from "./types";

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function reportStatus(issues: readonly ConformanceIssue[]): ConformanceReportStatus {
  if (issues.some((entry) => entry.disposition === "invalid")) return "invalid";
  if (issues.some((entry) => entry.disposition === "blocked")) return "blocked";
  if (issues.some((entry) => entry.disposition === "unresolved")) return "unresolved";
  return "verified";
}

function evidenceCounts(
  evidence: readonly EvidenceRecord[],
): Readonly<Record<EvidenceStatus, number>> {
  const counts: Record<EvidenceStatus, number> = {
    verified: 0,
    unresolved: 0,
    blocked: 0,
  };
  evidence.forEach((entry) => {
    counts[entry.status] += 1;
  });
  return counts;
}

export function generateConformanceReport(input: ConformanceReportInput): ConformanceReport {
  const manifestAudit = validateConformanceManifest(input.manifest);
  const evidenceAudit = validateEvidenceRecords(input.evidence);
  const evidence = evidenceAudit.value ?? [];
  const commandParity = auditCommandRegistry(
    input.authoritativeCommandTypes,
    input.commandRegistry,
  );
  const support = auditSupportClaims(manifestAudit.value, input.capabilities, evidence);
  const hardGates = auditHardGates(input.hardGates, evidence);
  const traceability = auditRequirementTraceability({
    profiles: manifestAudit.value?.profiles ?? [],
    evidence,
    requirements: input.requirements,
    traces: input.traces,
    expectedRequirementIds: PANEFOLD_V1_REQUIREMENT_IDS,
  });

  const reportIssues: ConformanceIssue[] = [
    ...manifestAudit.issues,
    ...evidenceAudit.issues,
    ...commandParity.issues,
    ...support.issues,
    ...traceability.issues,
    ...hardGates.issues,
  ];
  if (!isRfc3339(input.generatedAt)) {
    reportIssues.push(
      issue(
        "INVALID_REPORT_TIMESTAMP",
        "invalid",
        "/generatedAt",
        "Report generation time must be an explicit RFC 3339 timestamp; no clock value is inferred.",
      ),
    );
  }
  const issues = sortIssues(reportIssues);
  const dispositionCounts = countByDisposition(issues);

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    engineVersion: manifestAudit.value?.engineVersion ?? null,
    classification: manifestAudit.value?.classification ?? null,
    status: reportStatus(issues),
    summary: {
      invalid: dispositionCounts.invalid,
      blocked: dispositionCounts.blocked,
      unresolved: dispositionCounts.unresolved,
      warning: dispositionCounts.warning,
      expectedCommands: commandParity.expected.length,
      documentedCommands: commandParity.documented.length,
      expectedRequirements: traceability.expectedRequirementIds.length,
      definedRequirements: traceability.definedRequirementIds.length,
      expectedHardGates: hardGates.expectedGateIds.length,
      definedHardGates: hardGates.gates.length,
      evidence: evidenceCounts(evidence),
    },
    commandParity,
    support,
    traceability,
    hardGates,
    evidence,
    issues,
  };
}

function toCanonicalValue(value: unknown, ancestors: Set<object>, path: string): CanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}.`);
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`Non-JSON value at ${path}.`);
  }
  if (ancestors.has(value)) throw new TypeError(`Cyclic value at ${path}.`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) =>
        toCanonicalValue(entry, ancestors, `${path}/${index.toString()}`),
      );
    }
    if (!isPlainRecord(value)) throw new TypeError(`Non-plain object at ${path}.`);
    const output: Record<string, CanonicalValue> = {};
    Object.keys(value)
      .sort(compareCodeUnits)
      .forEach((key) => {
        output[key] = toCanonicalValue(value[key], ancestors, `${path}/${key}`);
      });
    return output;
  } finally {
    ancestors.delete(value);
  }
}

/** Stable pretty-printed JSON. It never reads locale state or the system clock. */
export function serializeConformanceReport(report: ConformanceReport): string {
  return `${JSON.stringify(toCanonicalValue(report, new Set(), ""), null, 2)}\n`;
}
