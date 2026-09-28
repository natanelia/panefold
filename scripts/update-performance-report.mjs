import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const suites = [
  ["benchmark-fingerprint", "Exact fingerprints"],
  ["benchmark-group-constraints", "Group constraints and combined layout solve"],
  ["benchmark-axis-rounding", "Pixel allocation"],
  ["benchmark-invalidation", "Invalidation controls"],
  ["benchmark-invalidation-batch", "Invalidation batches"],
  ["benchmark-persistence-bytes", "Bounded persistence validation"],
  ["benchmark-envelope", "Persistence envelope creation"],
];
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
};
const finitePositive = (value) => assert.ok(Number.isFinite(value) && value > 0);
const near = (left, right) =>
  assert.ok(Math.abs(left - right) <= Math.max(1, Math.abs(right)) * 1e-8);
const format = (value) => value.toFixed(3);
const range = (values) => `${format(Math.min(...values))}–${format(Math.max(...values))}`;
const hash = (text) => createHash("sha256").update(text).digest("hex");

export function summarizeReports(reports) {
  assert.equal(reports.length, 3, "Exactly three independent runs are required");
  const names = reports[0].results.map((result) => result.name);
  assert.ok(names.length > 0);
  assert.equal(new Set(names).size, names.length, "Duplicate workloads");
  for (const report of reports) {
    assert.equal(report.schemaVersion, 1);
    assert.deepEqual(
      report.results.map((result) => result.name),
      names,
      "Workload drift",
    );
    for (const result of report.results) {
      assert.equal(result.pairs, 21);
      assert.equal(result.rawSamples.baselineUs.length, 21);
      assert.equal(result.rawSamples.candidateUs.length, 21);
      for (const samples of Object.values(result.rawSamples)) samples.forEach(finitePositive);
      near(result.baselineMedianUs, median(result.rawSamples.baselineUs));
      near(result.candidateMedianUs, median(result.rawSamples.candidateUs));
      near(
        result.pairedMedianSpeedup,
        median(
          result.rawSamples.baselineUs.map((value, i) => value / result.rawSamples.candidateUs[i]),
        ),
      );
      assert.equal(result.speedupCI95.length, 2);
      result.speedupCI95.forEach(finitePositive);
      assert.ok(
        result.speedupCI95[0] <= result.pairedMedianSpeedup &&
          result.pairedMedianSpeedup <= result.speedupCI95[1],
      );
    }
  }
  return names.map((name, index) => {
    const results = reports.map((report) => report.results[index]);
    const faster = results.filter((result) => result.speedupCI95[0] > 1).length;
    const slower = results.filter((result) => result.speedupCI95[1] < 1).length;
    return {
      name,
      baselineUs: median(results.map((result) => result.baselineMedianUs)),
      candidateUs: median(results.map((result) => result.candidateMedianUs)),
      speedupRange: range(results.map((result) => result.pairedMedianSpeedup)),
      intervalEnvelope: `${format(Math.min(...results.map((result) => result.speedupCI95[0])))}–${format(Math.max(...results.map((result) => result.speedupCI95[1])))}`,
      result:
        slower > 0
          ? `Slowdown in ${slower}/3 runs`
          : faster === 3
            ? "Faster in 3/3 runs"
            : "Inconclusive in at least one run",
    };
  });
}

export async function generateReport(directory) {
  const read = async (path) => JSON.parse(await readFile(resolve(directory, path), "utf8"));
  const manifests = await Promise.all(
    [22, 24].map((version) => read(`node-${version}/manifest.json`)),
  );
  const [manifest] = manifests;
  assert.match(manifest.candidate, /^[a-f0-9]{40}$/);
  assert.match(manifest.baseline, /^[a-f0-9]{40}$/);
  for (const entry of manifests) {
    assert.equal(entry.candidate, manifest.candidate, "Mixed candidate revisions");
    assert.equal(entry.baseline, manifest.baseline, "Mixed baselines");
    assert.equal(entry.tree, manifest.tree, "Mixed source trees");
    assert.equal(entry.repeats, 3);
    assert.deepEqual(entry.sourceDigests, manifest.sourceDigests);
  }
  const sections = [];
  for (const version of [22, 24]) {
    for (const [file, title] of [
      ...suites,
      ...(version === 24 ? [["drop-measurement", "Browser drop measurement"]] : []),
    ]) {
      const reports = await Promise.all(
        [1, 2, 3].map((repeat) => read(`node-${version}/${file}-${repeat}.json`)),
      );
      for (const report of reports) {
        assert.ok(
          String(report.baseline).startsWith(manifest.baseline) ||
            (file === "benchmark-fingerprint" &&
              String(report.baseline).startsWith(manifest.baseline.slice(0, 7))),
          "Unexpected benchmark baseline",
        );
        assert.match(report.environment.node, new RegExp(`^v${version}\\.`));
      }
      sections.push({
        version,
        file,
        title,
        environment: reports[0].environment,
        rows: summarizeReports(reports),
      });
    }
  }
  const unit = await Promise.all([22, 24].map((version) => read(`node-${version}/unit.json`)));
  for (const report of unit) {
    assert.equal(report.success, true);
    assert.equal(report.numFailedTests, 0);
    assert.equal(report.numPendingTests, 0);
  }
  const browser = await read("node-24/browser.json");
  const site = await read("node-24/site-browser.json");
  for (const report of [browser, site]) {
    assert.equal(report.stats.unexpected, 0);
    assert.equal(report.stats.flaky, 0);
    assert.equal(report.errors.length, 0);
  }
  const lines = [
    "# Panefold performance audit",
    "",
    `Updated from the merged-code run on ${manifest.producedAt.slice(0, 10)}.`,
    "",
    "## Merged result",
    "",
    "PRs #39–#45 are merged. This report replaces the earlier pre-merge benchmark summary.",
    `Measured merge commit: \`${manifest.candidate}\`. Baseline: \`${manifest.baseline}\`.`,
    `Source tree: \`${manifest.tree}\`. [Executed workflow](${manifest.runUrl}).`,
    "",
    "The documentation website renders this Markdown file directly. There is no separate copy of the benchmark values.",
    "",
    "## Measurement method and limits",
    "",
    "Each workload ran three times per listed environment. Each run uses warmup, 21 alternating baseline/candidate batches, and a seeded 2,000-resample bootstrap interval for median paired speedup.",
    "The before and merged times below are medians of the three per-run medians, in microseconds per complete function call. Speedup is the range of per-run paired medians. Do not calculate it from the independently summarized time columns.",
    "The interval column is the envelope of the three individual 95% intervals. It is not a pooled 95% confidence interval. All controls and detected slowdowns remain visible. These exploratory comparisons have no multiple-comparison correction.",
    "",
    "These results compare the merged implementation with the pinned original. The full solve in the group-constraint suite includes both constraint and allocation changes. It must not be attributed to #40 alone. The allocation suite uses the same constraint callback in both solvers to isolate rounding.",
    "Envelope timings await the checksum. Only sha256 rows use real Web Crypto SHA-256; preparation rows use a test digest. Storage I/O, complete UI latency, and physical 60 Hz/120 Hz certification are excluded. Browser measurements use synthetic DOM layouts, not a complete pointer gesture.",
    "",
    "## Environments",
    "",
    "| Runtime | CPU | Operating system | Started (UTC) |",
    "|---|---|---|---|",
    ...manifests.map(
      (entry) => `| ${entry.node} | ${entry.cpu} | ${entry.os} | ${entry.producedAt} |`,
    ),
    "",
    `Browser: Chromium ${sections.find((section) => section.file === "drop-measurement").environment.browser}, in the Node 24 job. Runtime rows use separate runners. Do not compare their absolute speeds as a Node-version test.`,
    "",
    "## Selected workloads",
    "",
    "These cases show the main affected paths. The complete tables below include small-layout, no-change, single-change, and long-string controls.",
    "",
    "| Workload (Node 24) | Before / merged (µs) | Paired speedup range | Result |",
    "|---|---:|---:|---|",
  ];
  for (const [file, name, label] of [
    ["benchmark-fingerprint", "canonical/24-panels/ascii", "Canonical hash, 24 panels"],
    ["benchmark-group-constraints", "constraints/50-tabs", "Constraints, 50 tabs"],
    [
      "benchmark-group-constraints",
      "solve/16-groups/50-tabs",
      "Combined solve, 16 groups × 50 tabs",
    ],
    ["benchmark-axis-rounding", "axis/weighted/64", "Weighted allocation, 64 children"],
    [
      "benchmark-invalidation-batch",
      "all-constraints/500-groups",
      "500 constraint changes / 500 groups",
    ],
    ["benchmark-invalidation-batch", "weights/500-groups", "Weight-only resize / 500 groups"],
    ["benchmark-persistence-bytes", "workspace/24-panels", "Bounded validation, 24 panels"],
    ["benchmark-envelope", "sha256/500-panels", "Envelope with SHA-256, 500 panels"],
    ["drop-measurement", "unique/50-groups", "DOM drop measurement, 50 groups"],
    ["drop-measurement", "unique/500-groups", "DOM drop measurement, 500 groups"],
  ]) {
    const row = sections
      .find((section) => section.version === 24 && section.file === file)
      .rows.find((row) => row.name === name);
    assert.ok(row, `Missing required workload: ${file}/${name}`);
    lines.push(
      `| ${label} | ${format(row.baselineUs)} / ${format(row.candidateUs)} | ${row.speedupRange}× | ${row.result} |`,
    );
  }
  lines.push("", "## Regression checks on merged code", "");
  for (const [i, version] of [22, 24].entries())
    lines.push(
      `Node ${version}: ${unit[i].numPassedTests}/${unit[i].numTotalTests} unit tests passed in ${unit[i].testResults.length} files. Full pnpm check passed in the same workflow.`,
    );
  lines.push(
    `Main Chromium suite: ${browser.stats.expected} passed, ${browser.stats.skipped} skipped. Site suite: ${site.stats.expected} passed, ${site.stats.skipped} skipped. Neither report contains a failure or flaky test.`,
    "",
    "The independent semantic campaign report is retained with the raw results. The ten-million-command and physical-device certification gates remain unmet.",
    "",
    "## Complete paired results",
    "",
  );
  for (const section of sections) {
    lines.push(
      `### Node ${section.version}: ${section.title}`,
      "",
      "| Workload | Before / merged (µs) | Speedup range | Interval envelope | Result |",
      "|---|---:|---:|---:|---|",
    );
    for (const row of section.rows)
      lines.push(
        `| ${row.name} | ${format(row.baselineUs)} / ${format(row.candidateUs)} | ${row.speedupRange}× | ${row.intervalEnvelope}× | ${row.result} |`,
      );
    lines.push("");
  }
  lines.push(
    "## Node smoke checks",
    "",
    "These are absolute regression-guard timings, not paired speedup estimates. Ranges cover three runs.",
    "",
    "| Runtime / workload | Measured range |",
    "|---|---:|",
  );
  for (const version of [22, 24]) {
    const reports = await Promise.all(
      [1, 2, 3].map((repeat) => read(`node-${version}/smoke-${repeat}.json`)),
    );
    for (const report of reports) assert.equal(report.invariantViolations, 0);
    lines.push(
      `| Node ${version} / 10,000 kernel commands | ${range(reports.map((report) => report.kernel.elapsedMs))} ms |`,
    );
    for (const count of [50, 500])
      lines.push(
        `| Node ${version} / reorder ${count} panels, p95 | ${range(reports.map((report) => report.reorderProfiles.find((profile) => profile.panelCount === count).p95Ms))} ms |`,
      );
    for (const count of [100, 500, 1000])
      lines.push(
        `| Node ${version} / hit test ${count} nodes, mean | ${range(reports.map((report) => report.hitTestProfiles.find((profile) => profile.nodeCount === count).meanMicroseconds))} µs |`,
      );
  }
  lines.push(
    "",
    "## Raw evidence and reproduction",
    "",
    "All JSON samples and source manifests are checked in under docs/benchmarks/2026-09-28. The SHA256SUMS file identifies the retained bytes. The workflow artifacts retain the original reports without formatting changes.",
    "",
    "```bash",
    "pnpm install --frozen-lockfile",
    "pnpm build:packages",
    "for repeat in 1 2 3; do",
    "  for benchmark in scripts/benchmark-*.mjs; do",
    '    node "$benchmark"',
    "  done",
    "done",
    "pnpm exec playwright install --with-deps chromium",
    "node scripts/benchmarks/drop-measurement-browser.mjs",
    "node scripts/update-performance-report.mjs --check",
    "```",
    "",
    "## Audit decisions retained",
    "",
    "The direct table-order and lookup-map-to-cursor experiments were not merged. Their complete-workload gains were not repeatable. The invalidation and header-index changes retain their small-workload controls; a large-layout gain is not a claim that every call is faster.",
    "",
  );
  return lines.join("\n");
}
const normalizeMarkdown = (text) => text.replace(/^\|[-:| ]+\|$/gm, "").replace(/\s+/g, "");
export async function writeReport(root = resolve(import.meta.dirname, ".."), check = false) {
  const directory = resolve(root, "docs/benchmarks/2026-09-28");
  const report = await generateReport(directory);
  const target = resolve(root, "docs/PERFORMANCE.md");
  if (check)
    assert.equal(
      normalizeMarkdown(await readFile(target, "utf8")),
      normalizeMarkdown(report),
      "Performance report is stale",
    );
  else await writeFile(target, report);
  const entries = [];
  for (const version of [22, 24]) {
    for (const file of (await readdir(resolve(directory, `node-${version}`))).sort()) {
      if (!file.endsWith(".json")) continue;
      entries.push(
        `${hash(await readFile(resolve(directory, `node-${version}`, file)))}  node-${version}/${file}`,
      );
    }
  }
  const sums = `${entries.join("\n")}\n`;
  if (check)
    assert.equal(
      await readFile(resolve(directory, "SHA256SUMS"), "utf8"),
      sums,
      "Raw evidence digest mismatch",
    );
  else await writeFile(resolve(directory, "SHA256SUMS"), sums);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await writeReport(undefined, process.argv.includes("--check"));
