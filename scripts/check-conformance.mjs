import { readFile } from "node:fs/promises";
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
process.stdout.write(
  [
    `Conformance report: ${report.status}.`,
    `${String(summary.documentedCommands)}/${String(summary.expectedCommands)} commands documented.`,
    `${String(summary.definedRequirements)}/${String(summary.expectedRequirements)} requirements registered.`,
    `${String(summary.definedHardGates)}/${String(summary.expectedHardGates)} hard gates accounted for.`,
    `${String(summary.invalid)} invalid, ${String(summary.blocked)} blocked, ${String(summary.unresolved)} unresolved.`,
  ].join(" ") + "\n",
);

if (report.status === "invalid") {
  process.stderr.write(serializeConformanceReport(report));
  process.exitCode = 1;
}
