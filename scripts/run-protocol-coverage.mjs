import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { URL } from "node:url";
import { format } from "oxfmt";
import oxfmtConfig from "../.oxfmtrc.json" with { type: "json" };

import { runProtocolCoverage } from "./protocol-coverage-lib.mjs";
import {
  PROTOCOL_COVERAGE_SOURCE_DIGEST_PATHS,
  verifyProtocolCoverageResult,
} from "./verify-protocol-coverage.mjs";

const resultPath = "conformance/results/protocol-state-machine-coverage-2026-08-14.json";
const sourcePaths = PROTOCOL_COVERAGE_SOURCE_DIGEST_PATHS;

const { protocols, totals } = runProtocolCoverage();
const requireFromProtocolPackage = createRequire(
  new URL("../packages/protocol-xstate/package.json", import.meta.url),
);
const xstateVersion = requireFromProtocolPackage("xstate/package.json").version;
const sourceDigests = Object.fromEntries(
  await Promise.all(sourcePaths.map(async (path) => [path, digest(await readFile(path))])),
);
const result = {
  schemaVersion: 1,
  kind: "protocol-state-machine-coverage",
  status: "passed",
  producedAt: "2026-08-14T01:12:00Z",
  scope: "twelve-headless-appendix-c-protocol-actors",
  runner: {
    command: "pnpm protocol:coverage:check",
    nodeMajorVersions: [22, 24],
    xstate: xstateVersion,
    traversal: "bounded-breadth-first-v1",
    deterministicScheduler: "virtual-fifo-v1",
    maxSnapshotsPerProtocolInput: 1_000,
    maxExploredSnapshots: 20_000,
  },
  protocols,
  totals,
  sourceDigests,
  limitations: [
    "This result covers the twelve headless Appendix-C XState actors and the real scoped deadline delivery path; it is not browser timer, operating-system, or process-crash certification.",
    "Abstract popup, persistence, plugin, and coordinator failure events do not replace browser CSP/permission, storage-media, distributed-hosting, physical-monitor, or manual recovery evidence.",
    "TST-009 remains unresolved because this report does not establish a final authoritative surface or recoverable placeholder for every panel in the full Appendix-H recovery matrix.",
  ],
};

const failures = verifyProtocolCoverageResult(result);
if (failures.length > 0) {
  failures.forEach((failure) => process.stderr.write(`${failure}\n`));
  process.exitCode = 1;
} else {
  const formatted = await format(resultPath, JSON.stringify(result, null, 2), oxfmtConfig);
  if (formatted.errors.length > 0) {
    throw new Error(formatted.errors.map((error) => error.message).join("\n"));
  }
  const serialized = formatted.code;
  if (process.argv.includes("--write")) {
    await writeFile(resultPath, serialized, "utf8");
    process.stdout.write(
      `Wrote ${resultPath}: ${String(totals.coveredTransitions)}/${String(totals.documentedTransitions)} transitions and ${String(totals.coveredObligations)}/${String(totals.obligations)} obligations covered.\n`,
    );
  } else if (process.argv.includes("--check")) {
    const current = await readFile(resultPath, "utf8").catch(() => undefined);
    if (current !== serialized) {
      process.stderr.write(
        `${resultPath} is missing or stale. Run pnpm protocol:coverage:generate after building packages.\n`,
      );
      process.exitCode = 1;
    } else {
      process.stdout.write(
        `Protocol coverage verified: ${String(totals.coveredTransitions)}/${String(totals.documentedTransitions)} transitions, ${String(totals.coveredGuardPasses)}/${String(totals.guardedTransitions)} guard passes, ${String(totals.coveredGuardRejections)}/${String(totals.guardedTransitions)} guard rejections.\n`,
      );
    }
  } else {
    process.stdout.write(serialized);
  }
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
