import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const audit = readFileSync(resolve(repositoryRoot, "docs/DESIGN_AUDIT.md"), "utf8");
const requirements = readJson("conformance/requirements.json").requirements as readonly {
  readonly id: string;
}[];
const traces = readJson("conformance/traces.json").traces as readonly Trace[];
const gates = readJson("conformance/gates.json").hardGates as readonly Gate[];

const profiles = ["compact-react-chromium-desktop", "framework-adapter-contract-jsdom"] as const;
const statusAbbreviations: Readonly<Record<Trace["status"], string>> = {
  verified: "V",
  unresolved: "U",
  blocked: "B",
  "not-applicable": "N/A",
};
const correctedOverclaims = [
  "A11Y-002",
  "A11Y-006",
  "FOC-002",
  "INT-004",
  "LIF-003",
  "PKG-004",
  "RSP-002",
  "SCP-001",
  "THM-002",
  "TST-009",
] as const;
const actionParityRationales = {
  "A11Y-002":
    "The narrowed action registry matches the renderer routes it declares, but it omits structural operations from the complete Appendix G action set and is not generated from route-specific behavior tests.",
  "INT-004":
    "The narrowed action registry matches the renderer routes it declares, but it omits structural pointer actions from the complete Appendix G matrix and is not generated from route-specific keyboard, menu or command-palette, and programmatic tests.",
} as const;

describe("durable system-design audit", () => {
  it("keeps the exact 190-row profile matrix synchronized with generated traces", () => {
    const section = between(
      audit,
      "<!-- BEGIN REQUIREMENT STATUS MATRIX -->",
      "<!-- END REQUIREMENT STATUS MATRIX -->",
    );
    const rows = [
      ...section.matchAll(
        /^\|\s*`([A-Z0-9]+-\d{3})`\s*\|\s*(V|U|B|N\/A)\s*\|\s*(V|U|B|N\/A)\s*\|$/gm,
      ),
    ];
    expect(rows).toHaveLength(requirements.length);
    expect(new Set(rows.map((row) => row[1])).size).toBe(requirements.length);

    const documented = new Map(
      rows.map((row) => [row[1], { [profiles[0]]: row[2], [profiles[1]]: row[3] }]),
    );
    for (const requirement of requirements) {
      for (const profile of profiles) {
        const trace = traces.find(
          (candidate) =>
            candidate.requirementId === requirement.id && candidate.profileId === profile,
        );
        expect(trace, `${requirement.id}@${profile}`).toBeDefined();
        if (trace === undefined) throw new Error(`Missing trace ${requirement.id}@${profile}`);
        expect(documented.get(requirement.id)?.[profile]).toBe(statusAbbreviations[trace.status]);
      }
    }
  });

  it("records every corrected verification with an unresolved machine rationale", () => {
    const section = between(
      audit,
      "<!-- BEGIN CORRECTED OVERCLAIMS -->",
      "<!-- END CORRECTED OVERCLAIMS -->",
    );
    const documentedIds = [...section.matchAll(/^\|\s*`([A-Z0-9]+-\d{3})`\s*\|/gm)].map(
      (match) => match[1],
    );
    expect(documentedIds.sort()).toEqual([...correctedOverclaims].sort());

    for (const requirementId of correctedOverclaims) {
      const trace = traces.find(
        (candidate) =>
          candidate.requirementId === requirementId && candidate.profileId === profiles[0],
      );
      expect(trace?.status, requirementId).toBe("unresolved");
      expect(trace?.evidenceIds, requirementId).toBeDefined();
      expect(trace?.rationale.length, requirementId).toBeGreaterThan(80);
      expect(trace?.rationale, requirementId).not.toContain(
        "The repository implementation or its requirement-specific static/model proof is incomplete",
      );
      expect(trace?.rationale, requirementId).not.toContain(
        "A reproducible automated environment result with profile, workload, and execution metadata has not been recorded",
      );
    }
  });

  it("keeps the action-parity rationale exact and scoped to Appendix G", () => {
    const section = between(
      audit,
      "## Structural action parity audit",
      "## Genuine remaining gaps",
    );
    expect(section).toContain("complete Appendix G action set");
    expect(section).toContain("actions in Appendix G");
    expect(section).not.toContain("Appendix H");

    for (const [requirementId, rationale] of Object.entries(actionParityRationales)) {
      const trace = traces.find(
        (candidate) =>
          candidate.requirementId === requirementId && candidate.profileId === profiles[0],
      );
      expect(trace?.rationale, requirementId).toBe(rationale);
      expect(audit, requirementId).toContain(rationale);
    }
  });

  it("keeps all ten hard-gate labels and states synchronized", () => {
    const section = between(
      audit,
      "<!-- BEGIN HARD GATE STATUS -->",
      "<!-- END HARD GATE STATUS -->",
    );
    const documented = new Map(
      [...section.matchAll(/^\|\s*([A-Za-z ]+?)\s*\|\s*(Verified|Unresolved|Blocked)\s*\|/gm)].map(
        (match) => [gateId(requiredCapture(match, 1)), requiredCapture(match, 2).toLowerCase()],
      ),
    );
    expect(documented.size).toBe(10);
    expect(gates).toHaveLength(10);
    for (const gate of gates) expect(documented.get(gate.id), gate.id).toBe(gate.status);
  });
});

interface Trace {
  readonly requirementId: string;
  readonly profileId: string;
  readonly status: "verified" | "unresolved" | "blocked" | "not-applicable";
  readonly evidenceIds: readonly string[];
  readonly rationale: string;
}

interface Gate {
  readonly id: string;
  readonly status: "verified" | "unresolved" | "blocked";
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")) as Record<string, unknown>;
}

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (startIndex < 0 || endIndex <= startIndex) throw new Error(`Missing audit markers: ${start}`);
  return source.slice(startIndex + start.length, endIndex);
}

function gateId(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, "-");
}

function requiredCapture(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (value === undefined) throw new Error(`Missing regular-expression capture ${String(index)}`);
  return value;
}
