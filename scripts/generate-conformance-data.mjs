import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const producedAt = "2026-08-12T00:00:00Z";
const requirementsDocument = JSON.parse(await readFile("conformance/requirements.json", "utf8"));
const manifest = JSON.parse(await readFile("conformance/manifest.json", "utf8"));
const requirements = requirementsDocument.requirements;
const profileIds = manifest.profiles.map((profile) => profile.id);
const compactProfile = "compact-react-chromium-desktop";
const adapterProfile = "framework-adapter-contract-jsdom";

const sourceDefinitions = [
  [
    "dependency-architecture",
    "automated-test",
    ".dependency-cruiser.cjs",
    ["ARC-001", "ARC-005", "PKG-001", "PKG-002"],
    profileIds,
  ],
  [
    "model-immutability",
    "automated-test",
    "packages/model/test/model.test.ts",
    ["API-003", "DOM-001"],
    [compactProfile],
  ],
  [
    "kernel-laws",
    "model-report",
    "packages/kernel/test/properties.test.ts",
    [
      "LAY-001",
      "LAY-007",
      "MOD-001",
      "MOD-002",
      "MOD-003",
      "MOD-005",
      "TXN-001",
      "TXN-003",
      "TXN-004",
      "TXN-005",
    ],
    [compactProfile],
  ],
  [
    "bounded-exploration",
    "model-report",
    "packages/kernel/test/exploration.test.ts",
    ["TST-001", "TST-002"],
    [compactProfile],
  ],
  [
    "patch-replay-oracle",
    "automated-test",
    "packages/kernel/test/patches.test.ts",
    ["TST-002", "PER-008"],
    [compactProfile],
  ],
  [
    "geometry-solver",
    "automated-test",
    "packages/geometry/test/solve-layout.test.ts",
    ["LAY-002", "LAY-003", "LAY-004", "LAY-005"],
    [compactProfile],
  ],
  [
    "runtime-notification",
    "automated-test",
    "packages/runtime/test/runtime.test.ts",
    ["API-005", "OBS-002"],
    [compactProfile],
  ],
  [
    "persistence-recovery",
    "recovery-report",
    "packages/runtime/test/persistence.test.ts",
    ["PER-001", "PER-002", "PER-003", "PER-004", "PER-008", "SEC-001"],
    [compactProfile],
  ],
  [
    "indexeddb-effect",
    "migration-report",
    "packages/runtime-effect/test/persistence.test.ts",
    ["ARC-003", "PER-003"],
    [compactProfile],
  ],
  [
    "protocol-models",
    "model-report",
    "packages/protocol-xstate/test/protocol-machines.test.ts",
    ["ARC-002", "INT-003", "TST-003"],
    [compactProfile],
  ],
  [
    "protocol-actor-catalog",
    "model-report",
    "packages/protocol-xstate/test/catalog-machines.test.ts",
    ["ARC-002", "INT-003", "TST-003"],
    [compactProfile],
  ],
  [
    "motion-primitives",
    "automated-test",
    "packages/motion/test/motion.test.ts",
    ["ARC-004", "INT-001", "MOT-003", "MOT-004", "MOT-009", "A11Y-006"],
    [compactProfile],
  ],
  [
    "motion-lifecycle",
    "automated-test",
    "packages/motion/test/motion-lifecycle.test.ts",
    ["MOT-003", "MOT-004", "MOT-005", "MOT-007", "MOT-009", "MOT-010", "SYS-003", "TST-008"],
    [compactProfile],
  ],
  [
    "surface-ownership",
    "model-report",
    "packages/surfaces/test/surfaces.test.ts",
    ["COL-004", "LIF-005", "SUR-001", "SUR-003", "SUR-005", "SUR-007", "TST-004", "TST-009"],
    [compactProfile],
  ],
  [
    "react-integration",
    "automated-test",
    "packages/react/test/WorkspaceSurface.test.tsx",
    [
      "A11Y-003",
      "FOC-001",
      "FOC-003",
      "FOC-004",
      "LIF-001",
      "LIF-003",
      "LIF-006",
      "MOT-002",
      "REN-001",
      "REN-002",
      "REN-005",
    ],
    [compactProfile],
  ],
  [
    "native-adapter-contract",
    "compatibility-report",
    "packages/adapter-contract/test/native-adapters.test.ts",
    ["FWK-001", "FWK-003", "FWK-006"],
    [adapterProfile],
  ],
  [
    "web-component-ssr",
    "automated-test",
    "packages/web-components/test/ssr-import.test.ts",
    ["FWK-004"],
    [adapterProfile],
  ],
  [
    "ecosystem-primitives",
    "automated-test",
    "packages/ecosystem/test/ecosystem.test.ts",
    ["EXT-001", "EXT-003", "EXT-004", "OBS-002", "OBS-003"],
    [compactProfile],
  ],
  [
    "testkit-contract",
    "automated-test",
    "packages/testkit/test/testkit.test.ts",
    [
      "A11Y-002",
      "COL-004",
      "COL-005",
      "EXP-001",
      "INT-004",
      "PRF-002",
      "QLT-001",
      "QLT-003",
      "SUR-002",
      "SUR-003",
      "TST-004",
      "TST-009",
    ],
    [compactProfile],
  ],
  [
    "conformance-harness",
    "automated-test",
    "packages/conformance/test/report.test.ts",
    ["ACC-001", "OBS-006", "QLT-001", "QLT-002", "QLT-004"],
    profileIds,
  ],
  [
    "security-source-check",
    "security-report",
    "scripts/security-check.mjs",
    ["SEC-003", "SEC-008"],
    [compactProfile],
  ],
  [
    "performance-smoke",
    "performance-report",
    "scripts/performance-smoke.mjs",
    ["QLT-003", "TST-006"],
    [compactProfile],
  ],
  [
    "package-boundaries",
    "automated-test",
    "pnpm-lock.yaml",
    ["ARC-005", "PKG-003", "PKG-004", "PKG-005", "SEC-008"],
    profileIds,
  ],
  [
    "panel-registry",
    "automated-test",
    "packages/model/test/panel-registry.test.ts",
    ["API-001", "DOM-004", "EXT-002", "EXT-005", "PER-005"],
    [compactProfile],
  ],
  [
    "kernel-structural-sharing",
    "automated-test",
    "packages/kernel/test/kernel.test.ts",
    ["MOD-006", "PER-006", "SYS-001", "TXN-002", "TXN-008"],
    [compactProfile],
  ],
  [
    "optimized-campaign-runner",
    "model-report",
    "packages/kernel-optimized/test/differential.test.ts",
    ["MOD-004", "PRF-003", "TST-001", "TST-002"],
    [compactProfile],
  ],
  [
    "independent-semantic-oracle",
    "model-report",
    "packages/kernel-optimized/test/independent-reducer.test.ts",
    ["MOD-004", "PRF-003", "TST-002"],
    [compactProfile],
  ],
  [
    "geometry-invalidation",
    "automated-test",
    "packages/geometry/test/invalidation.test.ts",
    ["LAY-006", "PRF-006"],
    [compactProfile],
  ],
  [
    "runtime-fail-closed",
    "recovery-report",
    "packages/runtime/test/runtime.test.ts",
    ["OBS-004", "SEC-006", "SYS-004", "TXN-002"],
    [compactProfile],
  ],
  [
    "runtime-policy-contract",
    "automated-test",
    "packages/runtime/test/policy.test.ts",
    ["API-004", "TXN-006", "TXN-007"],
    [compactProfile],
  ],
  [
    "browser-surface-adapter",
    "automated-test",
    "packages/surfaces/test/browser-adapter.test.ts",
    [
      "LIF-002",
      "LIF-004",
      "LIF-005",
      "REN-003",
      "REN-004",
      "SEC-005",
      "SUR-002",
      "SUR-003",
      "SUR-004",
      "SUR-007",
    ],
    [compactProfile],
  ],
  [
    "localized-react-contract",
    "automated-test",
    "packages/react/test/WorkspaceSurface.test.tsx",
    ["I18N-001", "I18N-002", "RSP-001", "SYS-003", "TST-008", "TXN-008"],
    [compactProfile],
  ],
  [
    "plugin-isolation",
    "automated-test",
    "packages/ecosystem/test/isolated-frame.test.ts",
    ["EXT-001", "EXT-002", "EXT-004", "SEC-001", "SEC-005"],
    [compactProfile],
  ],
  [
    "authenticated-coordination",
    "automated-test",
    "packages/ecosystem/test/ecosystem.test.ts",
    [
      "COL-003",
      "COL-006",
      "EXT-001",
      "EXT-002",
      "EXT-003",
      "EXT-004",
      "OBS-003",
      "OBS-004",
      "PRF-004",
      "SEC-001",
      "SEC-002",
      "SEC-004",
    ],
    [compactProfile],
  ],
  [
    "evidence-taxonomy",
    "architecture-decision",
    "docs/adr/0010-executable-evidence-taxonomy.md",
    [
      "GOV-001",
      "GOV-002",
      "GOV-004",
      "QLT-001",
      "QLT-002",
      "QLT-004",
      "SCP-001",
      "SCP-002",
      "SCP-003",
      "SCP-004",
    ],
    profileIds,
  ],
  [
    "architecture-contract",
    "architecture-decision",
    "docs/ARCHITECTURE.md",
    [
      "API-002",
      "API-008",
      "ARC-004",
      "DOM-002",
      "DOM-003",
      "GOV-004",
      "SYS-001",
      "SYS-002",
      "SYS-005",
    ],
    profileIds,
  ],
  [
    "independent-oracle-decision",
    "architecture-decision",
    "docs/adr/0011-independent-semantic-oracle.md",
    ["GOV-004", "MOD-004", "PRF-003", "TST-002"],
    [compactProfile],
  ],
  [
    "protocol-motion-decision",
    "architecture-decision",
    "docs/adr/0012-bounded-protocol-and-motion-lifecycles.md",
    ["ARC-002", "ARC-004", "GOV-004", "MOT-003", "MOT-007", "SYS-003"],
    [compactProfile],
  ],
  [
    "third-party-certification-contract",
    "automated-test",
    "packages/conformance/test/certification.test.ts",
    ["GOV-006"],
    profileIds,
  ],
];

const resultDefinitions = [
  [
    "model-campaign-50000-result",
    "model-report",
    "conformance/results/model-campaign-50000-2026-08-12.json",
    ["MOD-004", "PRF-003", "TST-001", "TST-002"],
    [compactProfile],
    "code-verifiable",
  ],
  [
    "chromium-reference-result",
    "compatibility-report",
    "conformance/results/chromium-reference-2026-08-12.json",
    [
      "A11Y-003",
      "A11Y-006",
      "FOC-002",
      "I18N-002",
      "LIF-003",
      "LIF-005",
      "LIF-007",
      "REN-001",
      "REN-003",
      "REN-004",
      "REN-005",
      "REN-006",
      "RSP-001",
      "RSP-002",
      "SUR-002",
      "SUR-003",
      "THM-002",
    ],
    [compactProfile],
    "environment-verifiable",
  ],
  [
    "interaction-performance-result",
    "performance-report",
    "conformance/results/interaction-performance-2026-08-12.json",
    ["QLT-003", "TST-006"],
    [compactProfile],
    "environment-verifiable",
  ],
  [
    "framework-contract-result",
    "compatibility-report",
    "conformance/results/framework-contract-2026-08-12.json",
    ["FWK-001", "FWK-003"],
    [adapterProfile],
    "environment-verifiable",
  ],
  [
    "protocol-motion-result",
    "model-report",
    "conformance/results/protocol-motion-2026-08-12.json",
    [
      "ARC-002",
      "INT-003",
      "INT-006",
      "MOT-003",
      "MOT-004",
      "MOT-005",
      "MOT-007",
      "MOT-009",
      "MOT-010",
      "SYS-003",
      "TST-003",
      "TST-008",
    ],
    [compactProfile],
    "environment-verifiable",
  ],
  [
    "independent-semantic-oracle-result",
    "model-report",
    "conformance/results/independent-semantic-oracle-2026-08-12.json",
    ["MOD-004", "PRF-003", "TST-002"],
    [compactProfile],
    "code-verifiable",
  ],
];

const evidence = [];
for (const [id, kind, path, requirementIds, evidenceProfiles] of sourceDefinitions) {
  const bytes = await readFile(path);
  evidence.push({
    id,
    kind,
    status: "verified",
    verificationClass: "code-verifiable",
    artifactRole: "source",
    uri: `repo://${path}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    producedAt,
    requirementIds,
    profileIds: evidenceProfiles,
    note: "Content-addressed repository source artifact; it does not claim an executed environment result, manual assessment, or external certification.",
  });
}
for (const [
  id,
  kind,
  path,
  requirementIds,
  evidenceProfiles,
  verificationClass,
] of resultDefinitions) {
  const bytes = await readFile(path);
  evidence.push({
    id,
    kind,
    status: "verified",
    verificationClass,
    artifactRole: "result",
    uri: `repo://${path}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    producedAt,
    requirementIds,
    profileIds: evidenceProfiles,
    note: "Recorded execution result with an explicit experimental profile and limitations; it does not claim manual assessment or stable certification.",
  });
}
evidence.push(
  {
    id: "manual-accessibility-certification",
    kind: "external-certification",
    status: "blocked",
    verificationClass: "manual-external",
    artifactRole: "attestation",
    requirementIds: ["A11Y-001", "A11Y-005", "A11Y-008", "TST-007"],
    profileIds: [compactProfile],
    blockedBy: [
      "NVDA, JAWS, VoiceOver, TalkBack, 400% zoom, forced-colors, and voice-control assessment on real supported systems",
    ],
    note: "Automated axe and keyboard tests are present, but they cannot replace manual assistive-technology evidence.",
  },
  {
    id: "physical-performance-certification",
    kind: "external-certification",
    status: "blocked",
    verificationClass: "manual-external",
    artifactRole: "attestation",
    requirementIds: ["QLT-003", "TST-006"],
    profileIds: [compactProfile],
    blockedBy: ["controlled physical 60 Hz and 120 Hz hardware traces across mandatory workloads"],
    note: "The Node smoke workload is a regression guard, not a frame-performance certification.",
  },
  {
    id: "independent-security-review",
    kind: "external-certification",
    status: "blocked",
    verificationClass: "manual-external",
    artifactRole: "attestation",
    requirementIds: ["SEC-002", "SEC-003", "SEC-007"],
    profileIds: profileIds,
    blockedBy: [
      "independent threat-model, CSP and Trusted Types deployment, protocol, dependency, and provenance review",
    ],
    note: "Repository source checks do not establish absence of high-severity vulnerabilities.",
  },
  {
    id: "third-party-pilots",
    kind: "external-certification",
    status: "blocked",
    verificationClass: "manual-external",
    artifactRole: "attestation",
    requirementIds: ["EXT-006", "FWK-001"],
    profileIds: [adapterProfile],
    blockedBy: [
      "independent adopters integrating published packages and returning reproducible certification metadata",
    ],
    note: "A project cannot self-generate third-party pilot evidence.",
  },
);

const evidenceByRequirement = new Map();
for (const record of evidence) {
  for (const requirementId of record.requirementIds) {
    const ids = evidenceByRequirement.get(requirementId) ?? [];
    ids.push(record.id);
    evidenceByRequirement.set(requirementId, ids);
  }
}

const verifiedByProfile = {
  [compactProfile]: new Set([
    "API-001",
    "API-002",
    "API-003",
    "API-004",
    "API-005",
    "API-008",
    "ARC-001",
    "ARC-002",
    "ARC-003",
    "ARC-004",
    "ARC-005",
    "A11Y-003",
    "A11Y-006",
    "A11Y-002",
    "COL-004",
    "COL-005",
    "COL-003",
    "COL-006",
    "DOM-001",
    "DOM-002",
    "DOM-003",
    "DOM-004",
    "EXT-001",
    "EXT-002",
    "EXT-003",
    "EXT-004",
    "EXT-005",
    "FOC-001",
    "FOC-003",
    "FOC-004",
    "INT-001",
    "INT-003",
    "INT-004",
    "GOV-001",
    "GOV-002",
    "GOV-004",
    "GOV-006",
    "I18N-001",
    "I18N-002",
    "LAY-001",
    "LAY-002",
    "LAY-003",
    "LAY-004",
    "LAY-005",
    "LAY-007",
    "LIF-001",
    "LIF-003",
    "LIF-005",
    "LIF-006",
    "MOT-002",
    "MOT-003",
    "MOT-007",
    "MOD-001",
    "MOD-002",
    "MOD-003",
    "MOD-004",
    "MOD-005",
    "MOD-006",
    "OBS-002",
    "OBS-003",
    "OBS-004",
    "OBS-006",
    "PER-001",
    "PER-002",
    "PER-003",
    "PER-004",
    "PER-005",
    "PER-006",
    "PER-008",
    "PKG-001",
    "PKG-002",
    "PKG-003",
    "PKG-004",
    "PKG-005",
    "PRF-002",
    "PRF-003",
    "QLT-001",
    "QLT-002",
    "QLT-004",
    "REN-001",
    "REN-002",
    "REN-005",
    "SUR-001",
    "SUR-002",
    "SUR-003",
    "SUR-004",
    "SUR-005",
    "SUR-007",
    "SCP-001",
    "SCP-002",
    "SCP-003",
    "SCP-004",
    "SEC-001",
    "SEC-002",
    "SEC-004",
    "SEC-006",
    "SEC-008",
    "SYS-001",
    "SYS-002",
    "SYS-003",
    "SYS-004",
    "SYS-005",
    "THM-002",
    "TXN-001",
    "TXN-002",
    "TXN-003",
    "TXN-004",
    "TXN-005",
    "TXN-006",
    "TXN-007",
    "TXN-008",
    "TST-004",
    "TST-009",
    "TST-002",
    "FOC-002",
    "LIF-007",
    "REN-003",
    "REN-004",
    "REN-006",
    "RSP-001",
    "RSP-002",
  ]),
  [adapterProfile]: new Set(["FWK-001", "FWK-003", "FWK-006"]),
};

// A/B/C/D evidence taxonomy. Anything not explicitly environment-, manual-, or future-scoped is
// repository-code work. New requirements cannot bypass classification because the generated trace
// matrix must still contain one class for every requirement/profile cell.
const environmentVerifiable = new Set([
  "A11Y-003",
  "A11Y-005",
  "A11Y-006",
  "API-005",
  "DOM-005",
  "EXP-002",
  "EXP-003",
  "EXP-004",
  "FOC-002",
  "FOC-003",
  "FOC-004",
  "FOC-005",
  "FOC-006",
  "FWK-001",
  "FWK-002",
  "FWK-003",
  "FWK-004",
  "I18N-002",
  "INT-001",
  "INT-003",
  "INT-005",
  "INT-006",
  "INT-007",
  "LAY-006",
  "LIF-002",
  "LIF-003",
  "LIF-004",
  "LIF-005",
  "LIF-007",
  "MOT-002",
  "MOT-003",
  "MOT-004",
  "MOT-005",
  "MOT-006",
  "MOT-007",
  "MOT-009",
  "MOT-010",
  "OBS-001",
  "PRF-001",
  "PRF-004",
  "PRF-005",
  "PRF-006",
  "PER-007",
  "QLT-003",
  "REN-001",
  "REN-002",
  "REN-003",
  "REN-004",
  "REN-005",
  "REN-006",
  "RSP-001",
  "RSP-002",
  "SEC-003",
  "SEC-005",
  "SUR-002",
  "SUR-003",
  "SUR-005",
  "SUR-006",
  "SUR-007",
  "THM-001",
  "THM-002",
  "TST-005",
  "TST-006",
  "TST-008",
]);
const manualExternal = new Set([
  "A11Y-001",
  "A11Y-004",
  "A11Y-007",
  "A11Y-008",
  "ACC-002",
  "ACC-003",
  "ACC-001",
  "API-006",
  "API-007",
  "EXP-001",
  "EXP-005",
  "EXT-006",
  "FWK-006",
  "GOV-005",
  "GOV-003",
  "MOT-001",
  "PRF-007",
  "QLT-005",
  "RSK-001",
  "RSK-003",
  "RSK-004",
  "TST-007",
]);
const compactFutureScope = new Set(["COL-002", "FWK-005", "MOT-008"]);

assertTaxonomySets(requirements.map((requirement) => requirement.id));

const traces = [];
for (const profileId of profileIds) {
  for (const requirement of requirements) {
    const relevantEvidence = (evidenceByRequirement.get(requirement.id) ?? []).filter((id) => {
      const record = evidence.find((entry) => entry.id === id);
      return record?.profileIds.includes(profileId) === true;
    });
    const verifiedEvidence = relevantEvidence.filter(
      (id) => evidence.find((entry) => entry.id === id)?.status === "verified",
    );
    const adapterOutOfScope =
      profileId === adapterProfile &&
      !new Set(["ACC", "API", "ARC", "EXT", "FWK", "GOV", "OBS", "QLT", "SCP", "SEC", "TST"]).has(
        requirement.id.split("-")[0],
      );
    const verificationClass = classifyRequirement({
      profileId,
      requirementId: requirement.id,
      adapterOutOfScope,
    });
    const matchingVerifiedEvidence = verifiedEvidence.filter(
      (id) => evidence.find((entry) => entry.id === id)?.verificationClass === verificationClass,
    );
    if (verificationClass === "future-scope") {
      traces.push({
        requirementId: requirement.id,
        profileId,
        status: "not-applicable",
        verificationClass,
        evidenceIds: [],
        rationale: adapterOutOfScope
          ? "The framework store/lifecycle contract profile does not publish rendering, interaction, surface, or persistence support."
          : "The current profile does not publish the product capability governed by this requirement.",
      });
    } else if (
      verifiedByProfile[profileId].has(requirement.id) &&
      matchingVerifiedEvidence.length > 0
    ) {
      traces.push({
        requirementId: requirement.id,
        profileId,
        status: "verified",
        verificationClass,
        evidenceIds: matchingVerifiedEvidence,
        rationale: "Covered by repository-local automated evidence for this experimental profile.",
      });
    } else if (verificationClass === "manual-external") {
      traces.push({
        requirementId: requirement.id,
        profileId,
        status: "blocked",
        verificationClass,
        evidenceIds: relevantEvidence,
        rationale:
          "This requirement needs manual, physical-system, independent-review, adoption, usability, or signed-approval evidence that repository automation cannot manufacture.",
      });
    } else {
      traces.push({
        requirementId: requirement.id,
        profileId,
        status: "unresolved",
        verificationClass,
        evidenceIds: relevantEvidence,
        rationale:
          verificationClass === "code-verifiable"
            ? "The repository implementation or its requirement-specific static/model proof is incomplete for this profile."
            : "A reproducible automated environment result with profile, workload, and execution metadata has not been recorded.",
      });
    }
  }
}

function classifyRequirement({ profileId, requirementId, adapterOutOfScope }) {
  if (
    adapterOutOfScope ||
    (profileId === compactProfile && compactFutureScope.has(requirementId))
  ) {
    return "future-scope";
  }
  if (manualExternal.has(requirementId)) return "manual-external";
  if (environmentVerifiable.has(requirementId)) return "environment-verifiable";
  return "code-verifiable";
}

function assertTaxonomySets(requirementIds) {
  const known = new Set(requirementIds);
  const sets = [environmentVerifiable, manualExternal, compactFutureScope];
  for (const entries of sets) {
    for (const requirementId of entries) {
      if (!known.has(requirementId)) {
        throw new Error(`Evidence taxonomy references an unknown requirement: ${requirementId}`);
      }
    }
  }
  for (let left = 0; left < sets.length; left += 1) {
    for (let right = left + 1; right < sets.length; right += 1) {
      for (const requirementId of sets[left]) {
        if (sets[right].has(requirementId)) {
          throw new Error(`Evidence taxonomy assigns more than one class to ${requirementId}`);
        }
      }
    }
  }
}

const capabilities = [
  capability(
    "headless-model-kernel",
    "experimental",
    [compactProfile],
    [
      "model-immutability",
      "panel-registry",
      "kernel-laws",
      "bounded-exploration",
      "model-campaign-50000-result",
    ],
    ["The 50,000-operation result is below the ten-million stable threshold"],
  ),
  capability(
    "independent-semantic-oracle",
    "experimental",
    [compactProfile],
    [
      "independent-semantic-oracle",
      "independent-semantic-oracle-result",
      "independent-oracle-decision",
    ],
    [
      "The correctness-first candidate rebuilds Map/entity state per command; it is independent of the reference semantic reducer but is not a retained optimized production kernel",
    ],
  ),
  capability(
    "geometry-dom-projection",
    "experimental",
    [compactProfile],
    ["geometry-solver", "react-integration"],
    ["Reference React profile only"],
  ),
  capability(
    "react-stable-host-adapter",
    "experimental",
    [compactProfile],
    ["react-integration"],
    [
      "Production third-party heavy content and cross-document portal/mirror modes are not certified",
    ],
  ),
  capability(
    "interaction-motion",
    "experimental",
    [compactProfile],
    [
      "protocol-models",
      "protocol-actor-catalog",
      "motion-primitives",
      "motion-lifecycle",
      "protocol-motion-decision",
      "protocol-motion-result",
      "react-integration",
    ],
    ["No physical 60/120 Hz traces or complete platform interaction certification"],
  ),
  capability(
    "durable-persistence",
    "experimental",
    [compactProfile],
    ["persistence-recovery", "indexeddb-effect"],
    ["Failure injection is automated; real crash, quota, and corruption certification is pending"],
  ),
  capability(
    "prepared-surface-protocol",
    "experimental",
    [compactProfile],
    ["surface-ownership", "protocol-models"],
    [
      "Prepared ownership is implemented, but unrestricted browser/PiP/multi-screen product support is not published",
    ],
  ),
  capability(
    "native-framework-adapters",
    "experimental",
    [adapterProfile],
    ["native-adapter-contract", "web-component-ssr", "framework-contract-result"],
    ["Shared JSDOM contract only; no framework browser rendering certification"],
  ),
  capability(
    "trusted-plugin-registry",
    "experimental",
    [compactProfile],
    ["ecosystem-primitives"],
    ["Same-realm plugins are trusted and require application provenance policy"],
  ),
  capability(
    "observational-devtools",
    "experimental",
    [compactProfile],
    ["ecosystem-primitives"],
    ["Recorder projections must be supplied by the application"],
  ),
  capability(
    "authenticated-single-writer-coordination",
    "experimental",
    [compactProfile],
    ["authenticated-coordination", "kernel-laws"],
    [
      "Transport, key provisioning, authorization, durable hosting, and domain conflict policy are application-owned",
    ],
  ),
  capability(
    "react-responsive-projection",
    "experimental",
    [compactProfile],
    ["localized-react-contract", "chromium-reference-result"],
    ["Browser touch emulation is not physical mobile or assistive-technology certification"],
  ),
  capability(
    "browser-surface-adapter",
    "experimental",
    [compactProfile],
    ["browser-surface-adapter", "chromium-reference-result", "surface-ownership"],
    [
      "Controlled same-origin popup fixture only; permissioned PiP, cross-origin, crash, and multi-screen evidence is absent",
    ],
  ),
  capability(
    "panel-plugin-extension-boundary",
    "experimental",
    [compactProfile],
    ["panel-registry", "plugin-isolation", "ecosystem-primitives"],
    ["The isolated iframe host has no independent hostile-code or deployment certification"],
  ),
  capability(
    "testkit-fixtures",
    "experimental",
    [compactProfile],
    ["testkit-contract", "chromium-reference-result"],
    ["Fixture definitions and one browser run do not certify third-party workloads"],
  ),
  capability(
    "conformance-evidence-system",
    "experimental",
    [compactProfile],
    ["conformance-harness", "evidence-taxonomy", "third-party-certification-contract"],
    ["The current release remains blocked/unresolved and has no signed approval"],
  ),
  unsupported(
    "browser-popout-product-profile",
    "A controlled same-origin popup fixture exists, but no unrestricted cross-browser, cross-origin, or crash matrix is published",
  ),
  unsupported(
    "document-picture-in-picture-product-profile",
    "Capability-gated semantic primitives exist, but no browser certification is published",
  ),
  unsupported(
    "durable-distributed-collaboration",
    "Authenticated single-writer intake does not provide transport, durable hosting, recovery, or application conflict policy",
  ),
  unsupported(
    "arbitrary-untrusted-plugin-certification",
    "A sandboxed iframe host exists, but arbitrary hostile code and deployment policy have no independent certification",
  ),
  unsupported(
    "heavy-content-certification",
    "Synthetic lifecycle fixtures are not real editor, WebGL, media, iframe, grid, and microfrontend certification",
  ),
  unsupported(
    "mobile-touch-certification",
    "No physical coarse-pointer, virtual-keyboard, or mobile assistive-technology evidence",
  ),
  unsupported("multi-screen-product-profile", "No permission and monitor-removal browser evidence"),
  unsupported(
    "stable-conformance-certification",
    "Hard gates and external approvals remain incomplete",
  ),
];

const hardGates = [
  unresolvedGate(
    "model-integrity",
    ["LAY-001", "LAY-007", "MOD-001", "MOD-002", "MOD-005", "TST-001", "TST-002"],
    [compactProfile],
    ["code-verifiable"],
    ["bounded-exploration", "kernel-laws"],
    "Bounded exploration passes, but the required ten million generated commands are not published.",
  ),
  unresolvedGate(
    "determinism",
    ["MOD-002", "MOD-004", "PER-008", "PRF-003", "TST-002", "TXN-005"],
    [compactProfile],
    ["code-verifiable"],
    [
      "kernel-laws",
      "patch-replay-oracle",
      "independent-semantic-oracle",
      "independent-semantic-oracle-result",
    ],
    "The independent semantic oracle agrees with the reference in a bounded generated run, but it is not yet the retained optimized production kernel and the ten-million-command report is absent.",
  ),
  unresolvedGate(
    "atomicity",
    [
      "PER-003",
      "PER-004",
      "SUR-003",
      "TST-009",
      "TXN-001",
      "TXN-003",
      "TXN-004",
      "TXN-005",
      "TXN-007",
    ],
    [compactProfile],
    ["code-verifiable", "environment-verifiable"],
    ["kernel-laws", "persistence-recovery", "surface-ownership"],
    "Kernel atomicity passes locally; the complete fallible operational matrix is not certified.",
  ),
  blockedGate(
    "accessibility",
    [
      "A11Y-001",
      "A11Y-002",
      "A11Y-003",
      "A11Y-004",
      "A11Y-005",
      "A11Y-006",
      "A11Y-007",
      "A11Y-008",
      "FOC-003",
      "FOC-004",
      "REN-005",
      "TST-007",
      "TST-008",
    ],
    [compactProfile],
    ["environment-verifiable", "manual-external"],
    ["react-integration", "manual-accessibility-certification"],
    ["manual-accessibility-certification"],
  ),
  blockedGate(
    "lifecycle",
    [
      "LIF-001",
      "LIF-002",
      "LIF-003",
      "LIF-005",
      "LIF-006",
      "LIF-007",
      "MOT-003",
      "PRF-005",
      "REN-001",
      "REN-004",
      "REN-006",
    ],
    profileIds,
    ["environment-verifiable"],
    ["react-integration"],
    ["real heavy-content browser torture and resource-leak traces"],
  ),
  blockedGate(
    "performance",
    [
      "API-005",
      "INT-001",
      "INT-006",
      "LAY-006",
      "MOT-001",
      "MOT-010",
      "PRF-001",
      "PRF-002",
      "PRF-005",
      "PRF-006",
      "PRF-007",
      "QLT-003",
      "TST-006",
    ],
    [compactProfile],
    ["manual-external"],
    ["performance-smoke", "physical-performance-certification"],
    ["physical-performance-certification"],
  ),
  blockedGate(
    "recovery",
    [
      "EXP-004",
      "EXT-005",
      "LIF-005",
      "PER-002",
      "PER-003",
      "PER-004",
      "PER-005",
      "PER-007",
      "SUR-003",
      "SUR-005",
      "SYS-004",
      "TST-009",
    ],
    [compactProfile],
    ["environment-verifiable"],
    ["persistence-recovery", "surface-ownership", "testkit-contract"],
    ["real process, tab, window, IndexedDB quota/corruption, permission, and monitor failure runs"],
  ),
  blockedGate(
    "security",
    [
      "API-001",
      "COL-003",
      "EXT-002",
      "OBS-003",
      "SEC-001",
      "SEC-002",
      "SEC-003",
      "SEC-004",
      "SEC-005",
      "SEC-006",
      "SEC-007",
      "SEC-008",
    ],
    profileIds,
    ["code-verifiable", "environment-verifiable", "manual-external"],
    ["security-source-check", "independent-security-review"],
    ["independent-security-review"],
  ),
  unresolvedGate(
    "migration",
    ["DOM-004", "GOV-002", "PER-001", "PER-002", "PER-005", "SCP-004"],
    [compactProfile],
    ["code-verifiable", "environment-verifiable"],
    ["persistence-recovery"],
    "Kernel schema v1-to-v2 is tested; application and panel migration certification is not published.",
  ),
  unresolvedGate(
    "public-evidence",
    [
      "ACC-001",
      "ACC-002",
      "ACC-003",
      "EXT-006",
      "GOV-001",
      "GOV-003",
      "QLT-001",
      "QLT-002",
      "QLT-003",
      "QLT-004",
      "QLT-005",
      "SCP-001",
      "SCP-002",
      "TST-005",
      "TST-006",
      "TST-007",
    ],
    profileIds,
    ["code-verifiable", "manual-external"],
    ["conformance-harness", "performance-smoke", "testkit-contract"],
    "The register and harness are public, but raw traces and signed release approvals are incomplete.",
  ),
];

await write("conformance/evidence.json", { schemaVersion: 1, evidence });
await write("conformance/capabilities.json", { schemaVersion: 1, capabilities });
await write("conformance/traces.json", { schemaVersion: 1, traces });
await write("conformance/gates.json", { schemaVersion: 1, hardGates });
process.stdout.write(
  `Generated ${String(evidence.length)} evidence records and ${String(traces.length)} requirement traces.\n`,
);

function capability(id, classification, profiles, evidenceIds, limitations) {
  return { id, classification, profileIds: profiles, evidenceIds, limitations };
}

function unsupported(id, reason) {
  return capability(id, "unsupported", [], [], [reason]);
}

function unresolvedGate(id, requirementIds, profiles, requiredEvidenceClasses, evidenceIds, note) {
  return {
    id,
    status: "unresolved",
    requirementIds,
    profileIds: profiles,
    requiredEvidenceClasses,
    evidenceIds,
    note,
  };
}

function blockedGate(
  id,
  requirementIds,
  profiles,
  requiredEvidenceClasses,
  evidenceIds,
  blockedBy,
) {
  return {
    id,
    status: "blocked",
    requirementIds,
    profileIds: profiles,
    requiredEvidenceClasses,
    evidenceIds,
    blockedBy,
  };
}

async function write(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
