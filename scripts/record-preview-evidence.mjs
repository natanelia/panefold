/** Record only freshly executed, successful regression results. Never re-stamp old results. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import process from "node:process";
import { chromium } from "@playwright/test";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const date = "2026-09-17";
const browser = await readJson("artifacts/preview-browser.json");
const unit = await readJson("artifacts/preview-unit.json");
const nodeSmoke = await readJson("artifacts/preview-node-smoke.json");
assert.equal(browser.stats.unexpected, 0, "Browser failures cannot become passing evidence");
assert.equal(browser.stats.flaky, 0, "Flaky results need investigation before recording");
assert.equal(browser.stats.skipped, 0, "All reference browser tests must execute");
assert.equal(browser.errors.length, 0);
assert.ok(browser.stats.expected >= 46, "The full preview browser suite must execute");
assert.equal(unit.success, true);
assert.equal(unit.numFailedTests, 0);
assert.equal(unit.numPendingTests, 0);
assert.ok(unit.numPassedTests >= 532, "The full unit suite must execute");
const specs = (suite) => [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specs)];
const browserSpecs = browser.suites.flatMap(specs);
const performanceTest = browserSpecs.find((spec) => spec.file.endsWith("performance.spec.ts"));
const performanceResult = performanceTest?.tests
  .flatMap((test) => test.results)
  .find((result) => result.status === "passed");
const attachment = performanceResult?.attachments.find(
  (item) => item.name === "interaction-performance.json",
);
assert.ok(attachment, "The measured performance attachment is required");
const performance = JSON.parse(
  attachment.body === undefined
    ? await readFile(attachment.path, "utf8")
    : Buffer.from(attachment.body, "base64").toString("utf8"),
);
assert.ok(performance.sampleCount >= performance.baseline.minimumSamples);
assert.equal(performance.sampleCount, performance.rawFrameDeltasMs.length);
assert.ok(performance.summary.p95 <= performance.baseline.frameP95MaximumMs);
assert.ok(performance.summary.p99 <= performance.baseline.frameP99MaximumMs);
assert.ok(performance.longTasks.length <= performance.baseline.longTaskMaximumCount);
const launched = await chromium.launch();
const browserVersion = launched.version();
await launched.close();
const environment = {
  operatingSystem: `${os.type()} ${os.release()} ${os.arch()}`,
  node: process.version,
  browserVersion,
};
const producedAt = new Date(
  Date.parse(browser.stats.startTime) + browser.stats.duration,
).toISOString();
const runUrl = process.env.GITHUB_RUN_ID
  ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : undefined;
const rawReport = async (path) => ({
  path,
  sha256: digest(await readFile(path)),
  runUrl,
  artifact: "preview-executed-evidence",
});
const sourceDigests = async (name) => {
  const previous = await readJson(`conformance/results/${name}-2026-08-14.json`);
  const paths = new Set([
    ...Object.keys(previous.sourceDigests),
    "package.json",
    "pnpm-lock.yaml",
    "vitest.config.ts",
    "scripts/record-preview-evidence.mjs",
    "packages/react/src/drop-preview.ts",
    "packages/react/src/drop-target.ts",
    "packages/react/test/drop-preview.test.ts",
    "packages/react/test/drop-target.test.ts",
  ]);
  return Object.fromEntries(
    await Promise.all([...paths].sort().map(async (path) => [path, digest(await readFile(path))])),
  );
};
const limits = [
  "One automated Linux GitHub Actions run, not a stable browser or physical-device matrix.",
  "Emulated touch, automated axe, forced colors, and keyboard tests do not establish manual accessibility certification.",
  "The performance fixture measures splitter frames, not panel-drag latency or physical 60 Hz/120 Hz guarantees.",
  "Raw reports are also retained in the workflow artifact; artifact retention is 30 days.",
];
const write = async (name, result) =>
  writeFile(`conformance/results/${name}-${date}.json`, `${JSON.stringify(result, null, 2)}\n`);
await write("chromium-reference", {
  schemaVersion: 1,
  kind: "browser-profile-result",
  profile: "compact-react-chromium-desktop",
  producedAt,
  status: "passed",
  runner: "Playwright",
  command: "pnpm exec playwright test --reporter=json",
  project: "chromium",
  environment,
  summary: {
    tests: browser.stats.expected,
    passed: browser.stats.expected,
    skipped: browser.stats.skipped,
    failed: browser.stats.unexpected,
    durationMs: browser.stats.duration,
  },
  tests: browserSpecs.map((spec) => ({ file: spec.file, title: spec.title, ok: spec.ok })),
  rawReport: await rawReport("artifacts/preview-browser.json"),
  sourceDigests: await sourceDigests("chromium-reference"),
  limitations: limits,
});
await write("interaction-performance", {
  ...performance,
  producedAt,
  environment: { ...performance.environment, ...environment },
  nodeSmoke,
  rawReport: await rawReport("artifacts/preview-browser.json"),
  sourceDigests: await sourceDigests("interaction-performance"),
  limitations: limits,
});
const focusedResults = unit.testResults.filter((result) =>
  /\/packages\/(?:protocol|protocol-xstate|motion)\/test\//u.test(result.name),
);
const reactResults = unit.testResults.filter((result) =>
  result.name.includes("/packages/react/test/"),
);
const countPassed = (results) =>
  results.flatMap((result) => result.assertionResults).filter((item) => item.status === "passed")
    .length;
await write("protocol-motion", {
  schemaVersion: 1,
  kind: "protocol-motion-result",
  profile: "compact-react-chromium-desktop",
  producedAt,
  status: "passed",
  runner: "Vitest",
  command: "pnpm exec vitest run --reporter=json --outputFile=artifacts/preview-unit.json",
  environment,
  summary: {
    tests: unit.numTotalTests,
    passed: unit.numPassedTests,
    failed: unit.numFailedTests,
    files: unit.testResults.length,
    protocolMotionTestFiles: focusedResults.length,
    protocolMotionTests: countPassed(focusedResults),
    protocolMotionPassed: countPassed(focusedResults),
    reactIntegrationTestFiles: reactResults.length,
    reactIntegrationTests: countPassed(reactResults),
    reactIntegrationPassed: countPassed(reactResults),
  },
  tests: unit.testResults.map((result) => ({
    file: result.name.replace(`${process.cwd()}/`, ""),
    status: result.status,
    passed: result.assertionResults.filter((item) => item.status === "passed").length,
  })),
  rawReport: await rawReport("artifacts/preview-unit.json"),
  sourceDigests: await sourceDigests("protocol-motion"),
  limitations: [
    "Deterministic clocks, fake motion drivers, and jsdom do not establish browser or physical-system behavior.",
    "This run includes the full unit suite, not only the protocol and motion subset.",
    ...limits,
  ],
});

// Keep the published counts bound to the newly executed results.
const docsPath = "docs/CONFORMANCE.md";
const docs = await readFile(docsPath, "utf8");
const updatedDocs = docs
  .replace(
    /The checked-in result records \d+\/\d+ passing browser tasks/u,
    `The checked-in result records ${browser.stats.expected}/${browser.stats.expected} passing browser tasks`,
  )
  .replace(
    /Protocol\/motion validation passed \d+\/\d+ focused tests plus \d+\/\d+ React integration tests/u,
    `Protocol/motion validation passed ${countPassed(focusedResults)}/${countPassed(focusedResults)} focused tests plus ${countPassed(reactResults)}/${countPassed(reactResults)} React integration tests`,
  );
assert.match(updatedDocs, /The checked-in result records \d+\/\d+ passing browser tasks/u);
const currentDocs = updatedDocs.replace(
  /- The local automated interaction capture[\s\S]*?(?=\n\n## Hard release gates)/u,
  "- The Linux Chromium interaction capture records raw frame deltas, long tasks, and the paired " +
    "Node smoke measurements in `conformance/results/interaction-performance-2026-09-17.json`. " +
    "These are experimental regression guards, not physical performance certification.",
);
await writeFile(docsPath, currentDocs);
