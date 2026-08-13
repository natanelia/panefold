import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { generateConformanceReport } from "../packages/conformance/dist/index.js";
import { WORKSPACE_COMMAND_TYPES } from "../packages/model/dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const traceStatuses = ["verified", "unresolved", "blocked", "not-applicable"];
const verificationClasses = [
  "code-verifiable",
  "environment-verifiable",
  "manual-external",
  "future-scope",
];

const resultEvidenceIds = {
  chromium: "chromium-reference-result",
  framework: "framework-contract-result",
  protocolMotion: "protocol-motion-result",
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be a JSON object.`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be a JSON array.`);
  return value;
}

function requireInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function emptyCounts() {
  return {
    verified: 0,
    unresolved: 0,
    blocked: 0,
    "not-applicable": 0,
  };
}

function collectTraceClaims(traceDocument) {
  const traces = requireArray(requireRecord(traceDocument, "traces document").traces, "traces");
  const totals = emptyCounts();
  const byClass = Object.fromEntries(
    verificationClasses.map((verificationClass) => [verificationClass, emptyCounts()]),
  );

  traces.forEach((candidate, index) => {
    const trace = requireRecord(candidate, `traces[${String(index)}]`);
    const status = trace.status;
    const verificationClass = trace.verificationClass;
    if (!traceStatuses.includes(status)) {
      throw new TypeError(`traces[${String(index)}].status is not recognized.`);
    }
    if (!verificationClasses.includes(verificationClass)) {
      throw new TypeError(`traces[${String(index)}].verificationClass is not recognized.`);
    }
    totals[status] += 1;
    byClass[verificationClass][status] += 1;
  });

  return { cells: traces.length, totals, byClass };
}

function repositoryPathFromUri(uri, evidenceId) {
  const prefix = "repo://";
  if (typeof uri !== "string" || !uri.startsWith(prefix)) {
    throw new TypeError(`${evidenceId} must identify a repository-local result.`);
  }
  const path = resolve(repositoryRoot, uri.slice(prefix.length));
  const pathFromRoot = relative(repositoryRoot, path);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new TypeError(`${evidenceId} result path escapes the repository.`);
  }
  return path;
}

async function readEvidenceResult(evidenceDocument, evidenceId) {
  const evidence = requireArray(
    requireRecord(evidenceDocument, "evidence document").evidence,
    "evidence",
  );
  const matches = evidence.filter(
    (candidate) => isRecord(candidate) && candidate.id === evidenceId,
  );
  if (matches.length !== 1) {
    throw new TypeError(`${evidenceId} must occur exactly once in conformance/evidence.json.`);
  }
  const record = matches[0];
  if (record.status !== "verified" || record.artifactRole !== "result") {
    throw new TypeError(`${evidenceId} must be a verified result record.`);
  }
  return requireRecord(
    await readJson(repositoryPathFromUri(record.uri, evidenceId)),
    `${evidenceId} result`,
  );
}

function captureSingle(markdown, pattern, label, failures) {
  const matches = [...markdown.matchAll(pattern)];
  if (matches.length !== 1) {
    failures.push(
      `Documentation claim drift for ${label}: expected exactly one recognizable claim, found ${String(matches.length)}.`,
    );
    return undefined;
  }
  return matches[0].slice(1).map((value) => Number(value));
}

function compareClaim(actual, expected, label, failures) {
  if (actual === undefined) return;
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    failures.push(
      `Documentation claim drift for ${label}: expected ${expected.join("/")}, received ${actual.join("/")}.`,
    );
  }
}

function taxonomyPattern(label) {
  return new RegExp(
    String.raw`^\|\s*${label}\s*\|[^\n]*\|\s*(\d+) verified,\s*(\d+) unresolved,\s*(\d+) blocked,\s*(\d+) N\/A\s*\|$`,
    "gim",
  );
}

function validatePublishedClaims(markdown, claims) {
  const failures = [];
  const traceTotals = captureSingle(
    markdown,
    /the\s+(\d+)\s+trace cells currently\s+contain\s+(\d+) verified,\s+(\d+) unresolved,\s+(\d+) blocked,\s+and\s+(\d+) not applicable results/gi,
    "trace totals",
    failures,
  );
  compareClaim(
    traceTotals,
    [
      claims.traces.cells,
      claims.traces.totals.verified,
      claims.traces.totals.unresolved,
      claims.traces.totals.blocked,
      claims.traces.totals["not-applicable"],
    ],
    "trace totals",
    failures,
  );

  const aggregate = captureSingle(
    markdown,
    /aggregate validator report(?:, which)? currently\s+contains\s+(\d+) blocked issues and\s+(\d+) unresolved issues/gi,
    "aggregate validator totals",
    failures,
  );
  compareClaim(
    aggregate,
    [claims.aggregate.blocked, claims.aggregate.unresolved],
    "aggregate validator totals",
    failures,
  );

  const taxonomyLabels = {
    "code-verifiable": "A — code-verifiable",
    "environment-verifiable": "B — environment-verifiable",
    "manual-external": "C — manual/external",
    "future-scope": "D — future scope",
  };
  verificationClasses.forEach((verificationClass) => {
    const counts = claims.traces.byClass[verificationClass];
    const label = taxonomyLabels[verificationClass];
    compareClaim(
      captureSingle(markdown, taxonomyPattern(label), `${label} taxonomy`, failures),
      [counts.verified, counts.unresolved, counts.blocked, counts["not-applicable"]],
      `${label} taxonomy`,
      failures,
    );
  });

  compareClaim(
    captureSingle(
      markdown,
      /checked-in result records\s+(\d+)\/(\d+) passing\s+browser tasks/gi,
      "Chromium result",
      failures,
    ),
    [claims.results.chromium.passed, claims.results.chromium.tests],
    "Chromium result",
    failures,
  );
  compareClaim(
    captureSingle(
      markdown,
      /framework JSDOM contract passed\s+(\d+)\/(\d+) tests/gi,
      "framework result",
      failures,
    ),
    [claims.results.framework.passed, claims.results.framework.tests],
    "framework result",
    failures,
  );
  const protocolMotion = captureSingle(
    markdown,
    /Protocol\/motion validation passed\s+(\d+)\/(\d+) focused tests plus\s+(\d+)\/(\d+) React integration tests/gi,
    "protocol/motion result",
    failures,
  );
  compareClaim(
    protocolMotion,
    [
      claims.results.protocolMotion.protocolMotionPassed,
      claims.results.protocolMotion.protocolMotionTests,
      claims.results.protocolMotion.reactIntegrationPassed,
      claims.results.protocolMotion.reactIntegrationTests,
    ],
    "protocol/motion result",
    failures,
  );
  return failures;
}

function parseDocumentArgument(arguments_) {
  if (arguments_.length === 0) return resolve(repositoryRoot, "docs/CONFORMANCE.md");
  if (arguments_.length === 2 && arguments_[0] === "--document") {
    return resolve(process.cwd(), arguments_[1]);
  }
  throw new TypeError("Usage: node scripts/check-docs-claims.mjs [--document <path>]");
}

async function main() {
  const documentPath = parseDocumentArgument(process.argv.slice(2));
  const [
    markdown,
    manifest,
    commandDocument,
    capabilityDocument,
    evidenceDocument,
    requirementDocument,
    traceDocument,
    gateDocument,
  ] = await Promise.all([
    readFile(documentPath, "utf8"),
    readJson(resolve(repositoryRoot, "conformance/manifest.json")),
    readJson(resolve(repositoryRoot, "conformance/commands.json")),
    readJson(resolve(repositoryRoot, "conformance/capabilities.json")),
    readJson(resolve(repositoryRoot, "conformance/evidence.json")),
    readJson(resolve(repositoryRoot, "conformance/requirements.json")),
    readJson(resolve(repositoryRoot, "conformance/traces.json")),
    readJson(resolve(repositoryRoot, "conformance/gates.json")),
  ]);

  const report = generateConformanceReport({
    generatedAt: "2026-08-12T00:00:00Z",
    manifest,
    authoritativeCommandTypes: WORKSPACE_COMMAND_TYPES,
    commandRegistry: requireArray(commandDocument.commands, "commands"),
    capabilities: requireArray(capabilityDocument.capabilities, "capabilities"),
    evidence: requireArray(evidenceDocument.evidence, "evidence"),
    requirements: requireArray(requirementDocument.requirements, "requirements"),
    traces: requireArray(traceDocument.traces, "traces"),
    hardGates: requireArray(gateDocument.hardGates, "hardGates"),
  });
  const [chromium, framework, protocolMotion] = await Promise.all([
    readEvidenceResult(evidenceDocument, resultEvidenceIds.chromium),
    readEvidenceResult(evidenceDocument, resultEvidenceIds.framework),
    readEvidenceResult(evidenceDocument, resultEvidenceIds.protocolMotion),
  ]);
  const chromiumSummary = requireRecord(chromium.summary, "Chromium summary");
  const frameworkSummary = requireRecord(framework.summary, "framework summary");
  const protocolMotionSummary = requireRecord(protocolMotion.summary, "protocol/motion summary");
  const claims = {
    traces: collectTraceClaims(traceDocument),
    aggregate: {
      blocked: requireInteger(report.summary.blocked, "aggregate blocked count"),
      unresolved: requireInteger(report.summary.unresolved, "aggregate unresolved count"),
    },
    results: {
      chromium: {
        passed: requireInteger(chromiumSummary.passed, "Chromium passed count"),
        tests: requireInteger(chromiumSummary.tests, "Chromium test count"),
      },
      framework: {
        passed: requireInteger(frameworkSummary.passed, "framework passed count"),
        tests: requireInteger(frameworkSummary.tests, "framework test count"),
      },
      protocolMotion: {
        protocolMotionPassed: requireInteger(
          protocolMotionSummary.protocolMotionPassed,
          "protocol/motion passed count",
        ),
        protocolMotionTests: requireInteger(
          protocolMotionSummary.protocolMotionTests,
          "protocol/motion test count",
        ),
        reactIntegrationPassed: requireInteger(
          protocolMotionSummary.reactIntegrationPassed,
          "React integration passed count",
        ),
        reactIntegrationTests: requireInteger(
          protocolMotionSummary.reactIntegrationTests,
          "React integration test count",
        ),
      },
    },
  };

  const failures = validatePublishedClaims(markdown, claims);
  if (failures.length > 0) {
    failures.forEach((failure) => process.stderr.write(`${failure}\n`));
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Documentation claims match ${String(claims.traces.cells)} trace cells, aggregate report totals, and checked-in execution results.\n`,
  );
}

await main();
