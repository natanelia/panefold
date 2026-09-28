import { performance } from "node:perf_hooks";

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};
// Await every operation. Measuring only Promise creation would hide hashing cost.
export async function pairedAsyncBenchmark(
  name,
  baseline,
  candidate,
  { pairs = 21, targetMs = 20 } = {},
) {
  let sink;
  const run = async (operation, iterations) => {
    const start = performance.now();
    for (let i = 0; i < iterations; i += 1) sink = await operation(i);
    return performance.now() - start;
  };
  for (let i = 0; i < 4; i += 1) {
    await run(baseline, 8);
    await run(candidate, 8);
  }
  let iterations = 1;
  while (iterations < 65536 && (await run(baseline, iterations)) < targetMs) iterations *= 2;
  await run(candidate, iterations);
  const baselineUs = [],
    candidateUs = [];
  for (let pair = 0; pair < pairs; pair += 1) {
    let before, after;
    if (pair % 2 === 0) {
      before = await run(baseline, iterations);
      after = await run(candidate, iterations);
    } else {
      after = await run(candidate, iterations);
      before = await run(baseline, iterations);
    }
    baselineUs.push((before * 1000) / iterations);
    candidateUs.push((after * 1000) / iterations);
  }
  if (sink === undefined) throw new Error(`Benchmark ${name} did not consume a result`);
  const ratios = baselineUs.map((b, i) => b / candidateUs[i]);
  let seed = 20260928;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const bootstrap = Array.from({ length: 2000 }, () =>
    median(Array.from({ length: pairs }, () => ratios[Math.floor(random() * pairs)])),
  ).sort((a, b) => a - b);
  const speedupCI95 = [bootstrap[49], bootstrap[1949]];
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
