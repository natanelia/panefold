import { expect, test } from "@playwright/test";

import baseline from "./performance-baseline.json" with { type: "json" };

interface BrowserPerformanceCapture {
  readonly environment: {
    readonly userAgent: string;
    readonly hardwareConcurrency: number;
    readonly devicePixelRatio: number;
    readonly viewport: { readonly width: number; readonly height: number };
  };
  readonly rawFrameDeltasMs: readonly number[];
  readonly longTasks: readonly { readonly startTime: number; readonly duration: number }[];
}

test("preserves raw interaction frames and enforces the experimental CI guardrail", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const splitter = page.getByRole("separator").first();
  await expect(splitter).toBeVisible();
  const box = await splitter.boundingBox();
  if (box === null) throw new Error("Primary splitter has no browser bounds");

  const capturePromise = page.evaluate(
    async ({ sampleCount }): Promise<BrowserPerformanceCapture> => {
      const frameTimes: number[] = [];
      const longTasks: Array<{ readonly startTime: number; readonly duration: number }> = [];
      const observer =
        typeof PerformanceObserver === "undefined"
          ? undefined
          : new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                longTasks.push({ startTime: entry.startTime, duration: entry.duration });
              }
            });
      try {
        observer?.observe({ type: "longtask", buffered: true });
      } catch {
        // Long Task API availability is recorded by the empty list.
      }
      await new Promise<void>((resolve) => {
        const sample = (timestamp: number) => {
          frameTimes.push(timestamp);
          if (frameTimes.length >= sampleCount) resolve();
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      observer?.disconnect();
      return {
        environment: {
          userAgent: navigator.userAgent,
          hardwareConcurrency: navigator.hardwareConcurrency,
          devicePixelRatio: devicePixelRatio,
          viewport: { width: innerWidth, height: innerHeight },
        },
        rawFrameDeltasMs: frameTimes
          .slice(1)
          .map((time, index) => Number((time - (frameTimes[index] ?? time)).toFixed(3))),
        longTasks,
      };
    },
    { sampleCount: 180 },
  );

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 140, startY, { steps: 120 });
  await page.mouse.up();
  const capture = await capturePromise;
  const summary = summarize(capture.rawFrameDeltasMs);
  const report = {
    schemaVersion: 1,
    profile: baseline.profile,
    workload: baseline.workload,
    browser: testInfo.project.name,
    environment: capture.environment,
    sampleCount: capture.rawFrameDeltasMs.length,
    summary,
    rawFrameDeltasMs: capture.rawFrameDeltasMs,
    longTasks: capture.longTasks,
    baseline,
  };
  await testInfo.attach("interaction-performance.json", {
    body: Buffer.from(`${JSON.stringify(report, null, 2)}\n`),
    contentType: "application/json",
  });

  expect(capture.rawFrameDeltasMs.length).toBeGreaterThanOrEqual(baseline.minimumSamples);
  expect(summary.p95).toBeLessThanOrEqual(baseline.frameP95MaximumMs);
  expect(summary.p99).toBeLessThanOrEqual(baseline.frameP99MaximumMs);
  expect(capture.longTasks.length).toBeLessThanOrEqual(baseline.longTaskMaximumCount);
  await expect(page.getByText(/^Revision 1$/).first()).toBeVisible();
});

function summarize(samples: readonly number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  const mean = sorted.reduce((sum, sample) => sum + sample, 0) / sorted.length;
  return {
    minimum: sorted[0] ?? 0,
    maximum: sorted.at(-1) ?? 0,
    mean: Number(mean.toFixed(3)),
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function percentile(samples: readonly number[], quantile: number): number {
  if (samples.length === 0) return 0;
  const position = (samples.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = samples[lowerIndex] ?? 0;
  const upper = samples[upperIndex] ?? lower;
  return Number((lower + (upper - lower) * (position - lowerIndex)).toFixed(3));
}
