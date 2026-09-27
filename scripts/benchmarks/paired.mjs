import { performance } from "node:perf_hooks";
import { cpus, release } from "node:os";
import process from "node:process";

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

// Each sample is a whole batch, not an individual operation. Alternating order
// limits drift; the interval resamples paired speedups, never unpaired timings.
export function pairedBenchmark(name, baseline, candidate, { pairs = 21, targetMs = 20 } = {}) {
  let sink;
  const run = (operation, iterations) => {
    const start = performance.now();
    for (let index = 0; index < iterations; index += 1) sink = operation(index);
    return performance.now() - start;
  };
  for (let index = 0; index < 4; index += 1) {
    run(baseline, 16);
    run(candidate, 16);
  }
  let iterations = 1;
  while (iterations < 65_536 && run(baseline, iterations) < targetMs) iterations *= 2;
  run(candidate, iterations);
  const baselineUs = [];
  const candidateUs = [];
  for (let pair = 0; pair < pairs; pair += 1) {
    let before;
    let after;
    if (pair % 2 === 0) {
      before = run(baseline, iterations);
      after = run(candidate, iterations);
    } else {
      after = run(candidate, iterations);
      before = run(baseline, iterations);
    }
    baselineUs.push((before * 1_000) / iterations);
    candidateUs.push((after * 1_000) / iterations);
  }
  if (sink === undefined) throw new Error(`Benchmark ${name} did not consume a result`);
  const ratios = baselineUs.map((before, index) => before / candidateUs[index]);
  let seed = 20260927;
  const random = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const bootstrap = Array.from({ length: 2_000 }, () =>
    median(Array.from({ length: pairs }, () => ratios[Math.floor(random() * pairs)])),
  ).sort((a, b) => a - b);
  const speedupCI95 = [bootstrap[49], bootstrap[1_949]];
  return {
    name,
    iterations,
    pairs,
    baselineMedianUs: median(baselineUs),
    candidateMedianUs: median(candidateUs),
    pairedMedianSpeedup: median(ratios),
    speedupCI95,
    fasterInThisRun: speedupCI95[0] > 1,
    rawSamples: { baselineUs, candidateUs },
  };
}

export function reportBenchmarks(results, details = {}) {
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        environment: {
          node: process.version,
          v8: process.versions.v8,
          platform: process.platform,
          osRelease: release(),
          arch: process.arch,
          cpu: cpus()[0]?.model,
          logicalCpuCount: cpus().length,
          buildMode: "built ESM",
          timestamp: new Date().toISOString(),
        },
        methodology:
          "Alternating paired batches; 2,000-resample seeded bootstrap interval of median paired speedups. Single-process CPU timings, not browser frame-rate certification.",
        ...details,
        results,
      },
      null,
      2,
    )}\n`,
  );
}
