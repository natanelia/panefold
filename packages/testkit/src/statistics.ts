export interface SampleSummary {
  readonly count: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly mean: number;
  readonly median: number;
  readonly p95: number;
  readonly p99: number;
  readonly confidence95: readonly [lower: number, upper: number];
}

export interface PerformanceRegressionOptions {
  readonly direction: "lower-is-better" | "higher-is-better";
  readonly maximumRelativeRegression: number;
}

export interface PerformanceRegressionAssessment {
  readonly status: "pass" | "regression" | "inconclusive";
  readonly baseline: SampleSummary;
  readonly candidate: SampleSummary;
  readonly relativeChange: number;
  readonly statisticallySeparated: boolean;
  readonly reason: string;
}

export function summarizeSamples(samples: readonly number[]): SampleSummary {
  if (samples.length === 0 || !samples.every(Number.isFinite)) {
    throw new RangeError("Samples must be a non-empty list of finite numbers");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const sum = sorted.reduce((total, sample) => total + sample, 0);
  const mean = sum / sorted.length;
  const variance =
    sorted.length === 1
      ? 0
      : sorted.reduce((total, sample) => total + (sample - mean) ** 2, 0) / (sorted.length - 1);
  const margin = 1.96 * Math.sqrt(variance / sorted.length);
  const confidence95: readonly [number, number] = Object.freeze([mean - margin, mean + margin]);
  return Object.freeze({
    count: sorted.length,
    minimum: sorted[0] ?? 0,
    maximum: sorted.at(-1) ?? 0,
    mean,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    confidence95,
  });
}

/** Conservative CI separation check for reproducible performance gates. */
export function assessPerformanceRegression(
  baselineSamples: readonly number[],
  candidateSamples: readonly number[],
  options: PerformanceRegressionOptions,
): PerformanceRegressionAssessment {
  if (
    !Number.isFinite(options.maximumRelativeRegression) ||
    options.maximumRelativeRegression < 0 ||
    options.maximumRelativeRegression > 10
  ) {
    throw new RangeError("maximumRelativeRegression must be a finite number from 0 to 10");
  }
  const baseline = summarizeSamples(baselineSamples);
  const candidate = summarizeSamples(candidateSamples);
  const relativeChange =
    baseline.mean === 0
      ? candidate.mean === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : (candidate.mean - baseline.mean) / Math.abs(baseline.mean);
  const separated =
    options.direction === "lower-is-better"
      ? candidate.confidence95[0] > baseline.confidence95[1]
      : candidate.confidence95[1] < baseline.confidence95[0];
  const regressed =
    options.direction === "lower-is-better"
      ? relativeChange > options.maximumRelativeRegression
      : relativeChange < -options.maximumRelativeRegression;
  const status = separated && regressed ? "regression" : separated ? "pass" : "inconclusive";
  return Object.freeze({
    status,
    baseline,
    candidate,
    relativeChange,
    statisticallySeparated: separated,
    reason:
      status === "regression"
        ? "Confidence intervals are separated beyond the allowed regression tolerance."
        : status === "pass"
          ? "Confidence intervals are separated without exceeding the regression tolerance."
          : "The 95% confidence intervals overlap; the result is not statistically separated.",
  });
}

function percentile(sorted: readonly number[], quantile: number): number {
  const position = (sorted.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
}
