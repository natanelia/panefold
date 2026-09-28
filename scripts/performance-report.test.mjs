import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeReports } from "./update-performance-report.mjs";
function fixture(speedup = 2) {
  return {
    schemaVersion: 1,
    results: [
      {
        name: "case",
        pairs: 21,
        baselineMedianUs: 10,
        candidateMedianUs: 10 / speedup,
        pairedMedianSpeedup: speedup,
        speedupCI95: [speedup * 0.99, speedup * 1.01],
        rawSamples: { baselineUs: Array(21).fill(10), candidateUs: Array(21).fill(10 / speedup) },
      },
    ],
  };
}
test("summarizes all three runs, not the best run", () => {
  const [row] = summarizeReports([fixture(2), fixture(3), fixture(4)]);
  assert.equal(row.speedupRange, "2.000–4.000");
  assert.equal(row.candidateUs, 10 / 3);
  assert.equal(row.result, "Faster in 3/3 runs");
});
test("keeps small slowdowns and inconclusive controls visible", () => {
  assert.equal(
    summarizeReports([fixture(0.97), fixture(1), fixture(1.01)])[0].result,
    "Slowdown in 1/3 runs",
  );
  assert.equal(
    summarizeReports([fixture(2), fixture(1), fixture(2)])[0].result,
    "Inconclusive in at least one run",
  );
});
test("rejects missing repeats, drift and invalid raw samples", () => {
  assert.throws(() => summarizeReports([fixture()]));
  const changed = fixture();
  changed.results[0].name = "other";
  assert.throws(() => summarizeReports([fixture(), changed, fixture()]));
  const invalid = fixture();
  invalid.results[0].rawSamples.candidateUs[0] = 0;
  assert.throws(() => summarizeReports([fixture(), invalid, fixture()]));
});
test("rejects summaries that do not agree with the raw batches", () => {
  const altered = fixture();
  altered.results[0].baselineMedianUs = 12;
  assert.throws(() => summarizeReports([fixture(), altered, fixture()]));
});
