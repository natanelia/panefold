export type SupportClassification = "stable" | "experimental" | "deprecated" | "unsupported";

export type ConformanceDisposition = "invalid" | "blocked" | "unresolved" | "warning";

export interface ConformanceIssue {
  readonly code: string;
  readonly disposition: ConformanceDisposition;
  readonly path: string;
  readonly message: string;
}

export interface AuditResult<Value> {
  readonly valid: boolean;
  readonly value: Value | undefined;
  readonly issues: readonly ConformanceIssue[];
}

export interface SupportProfile {
  readonly id: string;
  readonly status: Exclude<SupportClassification, "unsupported">;
  readonly framework: string;
  readonly browser: string;
  readonly surfaces: readonly string[];
  readonly inputs: readonly string[];
  readonly workload: string;
  readonly accessibility?: readonly string[];
  readonly features?: readonly string[];
}

export interface ConformanceManifest {
  readonly $schema?: string;
  readonly engineVersion: string;
  readonly classification: SupportClassification;
  readonly generatedAt?: string;
  readonly profiles: readonly SupportProfile[];
  readonly unsupported: readonly string[];
  readonly knownLimitations?: readonly string[];
  readonly telemetryDefault: "off";
}

export type CommandSupportStatus =
  "stable-implemented" | "experimental-implemented" | "deprecated-implemented" | "unsupported";

export interface CommandRegistryEntry {
  readonly type: string;
  readonly status: CommandSupportStatus;
  readonly execution: string | null;
  readonly limitations: readonly string[];
}

export interface CommandParityReport {
  readonly expected: readonly string[];
  readonly documented: readonly string[];
  readonly missing: readonly string[];
  readonly unknown: readonly string[];
  readonly duplicate: readonly string[];
  readonly entries: readonly CommandRegistryEntry[];
  readonly issues: readonly ConformanceIssue[];
}

export type EvidenceStatus = "verified" | "unresolved" | "blocked";

export type EvidenceKind =
  | "automated-test"
  | "model-report"
  | "accessibility-report"
  | "performance-report"
  | "security-report"
  | "migration-report"
  | "recovery-report"
  | "compatibility-report"
  | "manual-assessment"
  | "formal-artifact"
  | "architecture-decision"
  | "external-certification"
  | "release-approval";

export interface EvidenceApproval {
  readonly issuer: string;
  readonly signedAt: string;
  readonly uri: string;
  readonly sha256: string;
}

export interface EvidenceRecord {
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly status: EvidenceStatus;
  readonly uri?: string;
  readonly sha256?: string;
  readonly producedAt?: string;
  readonly requirementIds: readonly string[];
  readonly profileIds: readonly string[];
  readonly blockedBy?: readonly string[];
  readonly note?: string;
  readonly approval?: EvidenceApproval;
}

export interface CapabilityClaim {
  readonly id: string;
  readonly classification: SupportClassification;
  readonly profileIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly limitations: readonly string[];
}

export interface SupportAuditReport {
  readonly capabilities: readonly CapabilityClaim[];
  readonly unclassifiedManifestCapabilities: readonly string[];
  readonly unpublishedUnsupportedCapabilities: readonly string[];
  readonly issues: readonly ConformanceIssue[];
}

export type RequirementLevel = "MUST" | "MUST NOT" | "SHOULD" | "SHOULD NOT";

export type RequirementApplicability = "universal" | "profile-scoped";

export interface RequirementDefinition {
  readonly id: string;
  readonly level: RequirementLevel;
  readonly applicability: RequirementApplicability;
  readonly statement?: string;
  readonly acceptanceEvidence?: string;
}

export type TraceStatus = "verified" | "unresolved" | "blocked" | "not-applicable";

export interface RequirementTrace {
  readonly requirementId: string;
  readonly profileId: string;
  readonly status: TraceStatus;
  readonly evidenceIds: readonly string[];
  readonly rationale?: string;
}

export interface RequirementTraceabilityReport {
  readonly expectedRequirementIds: readonly string[];
  readonly definedRequirementIds: readonly string[];
  readonly missingRequirementIds: readonly string[];
  readonly unknownRequirementIds: readonly string[];
  readonly missingTraceKeys: readonly string[];
  readonly traces: readonly RequirementTrace[];
  readonly issues: readonly ConformanceIssue[];
}

export interface RequirementTraceabilityInput {
  readonly expectedRequirementIds?: readonly string[];
  readonly profiles: readonly SupportProfile[];
  readonly evidence: readonly EvidenceRecord[];
  readonly requirements: readonly unknown[];
  readonly traces: readonly unknown[];
}

export type HardGateId =
  | "model-integrity"
  | "determinism"
  | "atomicity"
  | "accessibility"
  | "lifecycle"
  | "performance"
  | "recovery"
  | "security"
  | "migration"
  | "public-evidence";

export interface HardGateRecord {
  readonly id: HardGateId;
  readonly status: EvidenceStatus;
  readonly evidenceIds: readonly string[];
  readonly blockedBy?: readonly string[];
  readonly note?: string;
}

export interface HardGateAuditReport {
  readonly expectedGateIds: readonly HardGateId[];
  readonly gates: readonly HardGateRecord[];
  readonly missingGateIds: readonly HardGateId[];
  readonly unknownGateIds: readonly string[];
  readonly issues: readonly ConformanceIssue[];
}

export type ConformanceReportStatus = "verified" | "unresolved" | "blocked" | "invalid";

export interface ConformanceReportInput {
  readonly generatedAt: string;
  readonly manifest: unknown;
  readonly authoritativeCommandTypes: readonly string[];
  readonly commandRegistry: readonly unknown[];
  readonly capabilities: readonly unknown[];
  readonly evidence: readonly unknown[];
  readonly requirements: readonly unknown[];
  readonly traces: readonly unknown[];
  readonly hardGates: readonly unknown[];
}

export interface ConformanceReportSummary {
  readonly invalid: number;
  readonly blocked: number;
  readonly unresolved: number;
  readonly warning: number;
  readonly expectedCommands: number;
  readonly documentedCommands: number;
  readonly expectedRequirements: number;
  readonly definedRequirements: number;
  readonly expectedHardGates: number;
  readonly definedHardGates: number;
  readonly evidence: Readonly<Record<EvidenceStatus, number>>;
}

export interface ConformanceReport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly engineVersion: string | null;
  readonly classification: SupportClassification | null;
  readonly status: ConformanceReportStatus;
  readonly summary: ConformanceReportSummary;
  readonly commandParity: CommandParityReport;
  readonly support: SupportAuditReport;
  readonly traceability: RequirementTraceabilityReport;
  readonly hardGates: HardGateAuditReport;
  readonly evidence: readonly EvidenceRecord[];
  readonly issues: readonly ConformanceIssue[];
}
