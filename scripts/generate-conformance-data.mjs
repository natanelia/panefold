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

const verifiedDefinitions = [
  [
    "dependency-architecture",
    "automated-test",
    ".dependency-cruiser.cjs",
    ["ARC-001", "ARC-005"],
    [compactProfile],
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
    ["LAY-001", "LAY-007", "TXN-001", "TXN-003", "TXN-004", "TXN-005"],
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
    "motion-primitives",
    "automated-test",
    "packages/motion/test/motion.test.ts",
    ["ARC-004", "INT-001", "MOT-003", "MOT-004", "MOT-009", "A11Y-006"],
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
];

const evidence = [];
for (const [id, kind, path, requirementIds, evidenceProfiles] of verifiedDefinitions) {
  const bytes = await readFile(path);
  evidence.push({
    id,
    kind,
    status: "verified",
    uri: `repo://${path}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    producedAt,
    requirementIds,
    profileIds: evidenceProfiles,
    note: "Repository-local automated evidence; it does not imply external certification.",
  });
}

evidence.push(
  {
    id: "manual-accessibility-certification",
    kind: "external-certification",
    status: "blocked",
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
    requirementIds: ["QLT-003", "TST-006"],
    profileIds: [compactProfile],
    blockedBy: ["controlled physical 60 Hz and 120 Hz hardware traces across mandatory workloads"],
    note: "The Node smoke workload is a regression guard, not a frame-performance certification.",
  },
  {
    id: "independent-security-review",
    kind: "external-certification",
    status: "blocked",
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
    "API-003",
    "API-005",
    "ARC-001",
    "ARC-002",
    "ARC-003",
    "A11Y-003",
    "A11Y-006",
    "DOM-001",
    "FOC-001",
    "FOC-003",
    "FOC-004",
    "INT-001",
    "INT-003",
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
    "MOT-004",
    "MOT-009",
    "OBS-002",
    "OBS-006",
    "PER-001",
    "PER-002",
    "PER-003",
    "PER-004",
    "PER-008",
    "REN-001",
    "REN-002",
    "REN-005",
    "SUR-001",
    "SUR-005",
    "SUR-007",
    "TXN-001",
    "TXN-003",
    "TXN-004",
    "TXN-005",
  ]),
  [adapterProfile]: new Set(["FWK-001", "FWK-003", "FWK-006"]),
};

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
    const stableOnly = /\bstable (?:build|release|releases|supported profile)/iu.test(
      requirement.statement,
    );
    const adapterOutOfScope =
      profileId === adapterProfile &&
      !new Set(["ACC", "API", "ARC", "EXT", "FWK", "GOV", "OBS", "QLT", "SCP", "SEC", "TST"]).has(
        requirement.id.split("-")[0],
      );
    if (stableOnly || adapterOutOfScope) {
      traces.push({
        requirementId: requirement.id,
        profileId,
        status: "not-applicable",
        evidenceIds: relevantEvidence,
        rationale: stableOnly
          ? "The published profile is explicitly experimental; this stable-release requirement is not claimed."
          : "The framework store/lifecycle contract profile does not publish rendering, interaction, surface, or persistence support.",
      });
    } else if (verifiedByProfile[profileId].has(requirement.id) && verifiedEvidence.length > 0) {
      traces.push({
        requirementId: requirement.id,
        profileId,
        status: "verified",
        evidenceIds: verifiedEvidence,
        rationale: "Covered by repository-local automated evidence for this experimental profile.",
      });
    } else {
      traces.push({
        requirementId: requirement.id,
        profileId,
        status: "unresolved",
        evidenceIds: relevantEvidence,
        rationale:
          "The complete acceptance evidence described by the system design has not yet been produced for this profile.",
      });
    }
  }
}

const capabilities = [
  capability(
    "headless-model-kernel",
    "experimental",
    [compactProfile],
    ["model-immutability", "kernel-laws", "bounded-exploration"],
    ["No stable conformance or ten-million-operation report"],
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
    ["Cross-document lifecycle policies are not implemented by the DOM adapter"],
  ),
  capability(
    "interaction-motion",
    "experimental",
    [compactProfile],
    ["protocol-models", "motion-primitives", "react-integration"],
    ["No physical frame traces or tab-drag certification"],
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
    ["Headless protocol primitive; no published browser-window product profile"],
  ),
  capability(
    "native-framework-adapters",
    "experimental",
    [adapterProfile],
    ["native-adapter-contract", "web-component-ssr"],
    ["Shared JSDOM contract only; no framework browser rendering certification"],
  ),
  capability(
    "trusted-plugin-registry",
    "experimental",
    [compactProfile],
    ["ecosystem-primitives"],
    ["Trusted in-process declarative contributions only"],
  ),
  capability(
    "observational-devtools",
    "experimental",
    [compactProfile],
    ["ecosystem-primitives"],
    ["Recorder projections must be supplied by the application"],
  ),
  capability(
    "remote-command-intake",
    "experimental",
    [compactProfile],
    ["ecosystem-primitives", "kernel-laws"],
    ["No transport, authentication, durable coordinator, or conflict resolution"],
  ),
  capability(
    "mobile-projection",
    "experimental",
    [compactProfile],
    ["ecosystem-primitives"],
    ["Data-only projection; not a certified touch product"],
  ),
  unsupported(
    "browser-popout-product-profile",
    "Prepared ownership primitives exist, but no real browser failure matrix is published",
  ),
  unsupported(
    "document-picture-in-picture-product-profile",
    "Capability-gated semantic primitives exist, but no browser certification is published",
  ),
  unsupported(
    "durable-distributed-collaboration",
    "Remote intake is not distributed collaboration",
  ),
  unsupported(
    "dynamic-untrusted-plugins",
    "Trusted in-process registration is not an isolation boundary",
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
    ["bounded-exploration", "kernel-laws"],
    "Bounded exploration passes, but the required ten million generated commands are not published.",
  ),
  unresolvedGate(
    "determinism",
    ["kernel-laws", "patch-replay-oracle"],
    "Automated determinism evidence exists, but the independent optimized-kernel long-run report is incomplete.",
  ),
  unresolvedGate(
    "atomicity",
    ["kernel-laws", "persistence-recovery", "surface-ownership"],
    "Kernel atomicity passes locally; the complete fallible operational matrix is not certified.",
  ),
  blockedGate(
    "accessibility",
    ["react-integration", "manual-accessibility-certification"],
    ["manual-accessibility-certification"],
  ),
  blockedGate(
    "lifecycle",
    ["react-integration"],
    ["real heavy-content browser torture and resource-leak traces"],
  ),
  blockedGate(
    "performance",
    ["performance-smoke", "physical-performance-certification"],
    ["physical-performance-certification"],
  ),
  blockedGate(
    "recovery",
    ["persistence-recovery", "surface-ownership"],
    ["real process, tab, window, IndexedDB quota/corruption, permission, and monitor failure runs"],
  ),
  blockedGate(
    "security",
    ["security-source-check", "independent-security-review"],
    ["independent-security-review"],
  ),
  unresolvedGate(
    "migration",
    ["persistence-recovery"],
    "Kernel schema v1-to-v2 is tested; application and panel migration certification is not published.",
  ),
  unresolvedGate(
    "public-evidence",
    ["conformance-harness", "performance-smoke"],
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

function unresolvedGate(id, evidenceIds, note) {
  return { id, status: "unresolved", evidenceIds, note };
}

function blockedGate(id, evidenceIds, blockedBy) {
  return { id, status: "blocked", evidenceIds, blockedBy };
}

async function write(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
