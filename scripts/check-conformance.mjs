import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";

import {
  generateConformanceReport,
  serializeConformanceReport,
} from "../packages/conformance/dist/index.js";
import { WORKSPACE_COMMAND_TYPES } from "../packages/model/dist/index.js";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const [
  manifest,
  commandDocument,
  capabilityDocument,
  evidenceDocument,
  requirementDocument,
  traceDocument,
  gateDocument,
  publishedManifestSchema,
  packageManifestSchema,
] = await Promise.all([
  readJson("conformance/manifest.json"),
  readJson("conformance/commands.json"),
  readJson("conformance/capabilities.json"),
  readJson("conformance/evidence.json"),
  readJson("conformance/requirements.json"),
  readJson("conformance/traces.json"),
  readJson("conformance/gates.json"),
  readJson("conformance/manifest.schema.json"),
  readJson("packages/conformance/schema/manifest.schema.json"),
]);

if (!isDeepStrictEqual(publishedManifestSchema, packageManifestSchema)) {
  process.stderr.write(
    "conformance/manifest.schema.json has drifted from the validator package schema.\n",
  );
  process.exitCode = 1;
}

const report = generateConformanceReport({
  generatedAt: "2026-08-12T00:00:00Z",
  manifest,
  authoritativeCommandTypes: WORKSPACE_COMMAND_TYPES,
  commandRegistry: commandDocument.commands,
  capabilities: capabilityDocument.capabilities,
  evidence: evidenceDocument.evidence,
  requirements: requirementDocument.requirements,
  traces: traceDocument.traces,
  hardGates: gateDocument.hardGates,
});

const { summary } = report;
const taxonomy = report.traceability.byVerificationClass;
process.stdout.write(
  [
    `Conformance report: ${report.status}.`,
    `${String(summary.documentedCommands)}/${String(summary.expectedCommands)} commands documented.`,
    `${String(summary.definedRequirements)}/${String(summary.expectedRequirements)} requirements registered.`,
    `${String(summary.definedHardGates)}/${String(summary.expectedHardGates)} hard gates accounted for.`,
    `${String(summary.invalid)} invalid, ${String(summary.blocked)} blocked, ${String(summary.unresolved)} unresolved.`,
    `Trace taxonomy: A/code ${formatTraceCounts(taxonomy["code-verifiable"])};`,
    `B/environment ${formatTraceCounts(taxonomy["environment-verifiable"])};`,
    `C/manual-external ${formatTraceCounts(taxonomy["manual-external"])};`,
    `D/future ${formatTraceCounts(taxonomy["future-scope"])}.`,
  ].join(" ") + "\n",
);

const artifactFailures = await verifyRepositoryEvidence(report.evidence);
artifactFailures.forEach((failure) => process.stderr.write(`${failure}\n`));

if (report.status === "invalid" || artifactFailures.length > 0) {
  process.stderr.write(serializeConformanceReport(report));
  process.exitCode = 1;
}

if (report.classification === "stable" && report.status !== "verified") {
  process.stderr.write(
    `Stable release claim rejected: conformance status is ${report.status}, not verified.\n`,
  );
  process.exitCode = 1;
}

if (process.argv.includes("--require-verified") && report.status !== "verified") {
  process.stderr.write(
    `Verified conformance was required explicitly, but the report status is ${report.status}.\n`,
  );
  process.exitCode = 1;
}

function formatTraceCounts(counts) {
  return `${String(counts.verified)} verified/${String(counts.unresolved)} unresolved/${String(counts.blocked)} blocked/${String(counts.notApplicable)} n/a`;
}

async function verifyRepositoryEvidence(evidence) {
  const failures = [];
  const root = await realpath(process.cwd());
  for (const record of evidence) {
    if (record.status !== "verified" || !record.uri?.startsWith("repo://")) continue;
    const repositoryPath = record.uri.slice("repo://".length);
    const candidate = resolve(root, repositoryPath);
    let target;
    try {
      target = await realpath(candidate);
    } catch (error) {
      failures.push(
        `Evidence artifact missing for ${record.id}: ${repositoryPath} (${error instanceof Error ? error.message : String(error)}).`,
      );
      continue;
    }
    const pathFromRoot = relative(root, target);
    if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
      failures.push(
        `Evidence artifact escapes the repository for ${record.id}: ${repositoryPath}.`,
      );
      continue;
    }
    const bytes = await readFile(target);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== record.sha256) {
      failures.push(
        `Evidence digest mismatch for ${record.id}: expected ${record.sha256}, received ${actual}.`,
      );
    }
  }
  return failures;
}
