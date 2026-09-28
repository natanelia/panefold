import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cpus, release } from "node:os";
import { chromium } from "@playwright/test";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const baseline = process.env.PANEFOLD_BENCHMARK_BASE ?? "81b11b4fab78a8824243fd6b3a28e50131b997f0";
const sourcePath = "packages/react/src/drop-preview.ts";
const before = execFileSync("git", ["show", `${baseline}:${sourcePath}`], {
  cwd: root,
  encoding: "utf8",
});
const after = await readFile(new URL(`../../${sourcePath}`, import.meta.url), "utf8");
const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText).toString("base64")}`;
const browser = await chromium.launch({
  ...(process.env.PANEFOLD_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PANEFOLD_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const results = await page.evaluate(
    async ({ beforeUrl, afterUrl }) => {
      const original = (await import(beforeUrl)).measureDropGroups;
      const candidate = (await import(afterUrl)).measureDropGroups;
      const results = [];
      for (const [count, mode] of [
        [1, "unique"],
        [7, "unique"],
        [8, "unique"],
        [50, "unique"],
        [200, "unique"],
        [500, "unique"],
        [50, "duplicate"],
        [50, "hidden"],
        [8, "single-visible"],
        [50, "single-visible"],
        [500, "single-visible"],
      ]) {
        document.body.replaceChildren();
        document.body.style.margin = "0";
        const root = document.createElement("div");
        root.className = "pf-workspace";
        Object.assign(root.style, {
          position: "relative",
          width: "800px",
          height: `${count * 80}px`,
        });
        document.body.append(root);
        const groupRects = Object.create(null);
        for (let index = 0; index < count; index += 1) {
          const group = document.createElement("section");
          group.dataset.workspaceGroup = `g:${index}`;
          const label = mode === "duplicate" ? "shared" : `label:${index}`;
          group.setAttribute("aria-labelledby", label);
          Object.assign(group.style, {
            position: "absolute",
            left: "0",
            top: `${index * 80}px`,
            width: "800px",
            height: "80px",
          });
          const slot = document.createElement("div");
          slot.dataset.workspacePanelSlot = "";
          Object.assign(slot.style, {
            position: "absolute",
            left: "0",
            top: "20px",
            width: "800px",
            height: "60px",
            display:
              mode === "hidden" || (mode === "single-visible" && index > 0) ? "none" : "block",
          });
          const header = document.createElement("div");
          header.className = "pf-tab-strip";
          Object.assign(header.style, {
            position: "absolute",
            left: "0",
            top: `${index * 80}px`,
            width: "800px",
            height: "20px",
          });
          const strip = document.createElement("div");
          strip.setAttribute("role", "tablist");
          strip.setAttribute("aria-labelledby", label);
          header.append(strip);
          group.append(slot);
          root.append(group, header);
          groupRects[`g:${index}`] = {
            inlineStart: 0,
            blockStart: index * 80,
            inlineSize: 800,
            blockSize: 80,
          };
        }
        const bounds = { inlineStart: 0, blockStart: 0, inlineSize: 800, blockSize: count * 80 };
        const rootRect = root.getBoundingClientRect();
        const layout = {
          rootNodeId: "root",
          nodeRects: {},
          groupRects,
          splitters: [],
          collapsedNodeIds: [],
          diagnostics: [],
        };
        const args = [root, rootRect, bounds, layout, "ltr"];
        const expected = original(...args),
          actual = candidate(...args);
        if (JSON.stringify(actual) !== JSON.stringify(expected))
          throw new Error("Different measured geometry");
        if (
          Object.keys(actual).length !==
          (mode === "hidden" ? 0 : mode === "single-visible" ? 1 : count)
        )
          throw new Error("Unmeasured fixture");
        let sink;
        const run = (operation, iterations) => {
          const start = performance.now();
          for (let i = 0; i < iterations; i += 1) sink = operation(...args);
          return performance.now() - start;
        };
        for (let i = 0; i < 4; i += 1) {
          run(original, 8);
          run(candidate, 8);
        }
        let iterations = 1;
        while (iterations < 32768) {
          const a = run(original, iterations),
            b = run(candidate, iterations);
          if (a >= 20 && b >= 8) break;
          iterations *= 2;
        }
        const baselineUs = [],
          candidateUs = [];
        for (let pair = 0; pair < 21; pair += 1) {
          let a, b;
          if (pair % 2 === 0) {
            a = run(original, iterations);
            b = run(candidate, iterations);
          } else {
            b = run(candidate, iterations);
            a = run(original, iterations);
          }
          baselineUs.push((a * 1000) / iterations);
          candidateUs.push((b * 1000) / iterations);
        }
        if (sink === undefined) throw new Error("Unused result");
        results.push({
          name: `${mode}/${count}-groups`,
          iterations,
          pairs: 21,
          rawSamples: { baselineUs, candidateUs },
        });
      }
      return results;
    },
    { beforeUrl: moduleUrl(before), afterUrl: moduleUrl(after) },
  );
  const median = (values) => {
    const a = [...values].sort((a, b) => a - b),
      m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  for (const result of results) {
    const { baselineUs, candidateUs } = result.rawSamples;
    assert.equal(baselineUs.length, 21);
    assert.equal(candidateUs.length, 21);
    const ratios = baselineUs.map((b, i) => b / candidateUs[i]);
    let seed = 20260928;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const bootstrap = Array.from({ length: 2000 }, () =>
      median(Array.from({ length: 21 }, () => ratios[Math.floor(random() * 21)])),
    ).sort((a, b) => a - b);
    Object.assign(result, {
      baselineMedianUs: median(baselineUs),
      candidateMedianUs: median(candidateUs),
      pairedMedianSpeedup: median(ratios),
      speedupCI95: [bootstrap[49], bootstrap[1949]],
      fasterInThisRun: bootstrap[49] > 1,
    });
  }
  process.stdout.write(
    `${JSON.stringify({ schemaVersion: 1, baseline, environment: { node: process.version, browser: browser.version(), os: release(), cpu: cpus()[0]?.model, executableOverride: process.env.PANEFOLD_CHROMIUM_EXECUTABLE_PATH ?? null, producedAt: new Date().toISOString() }, methodology: "Real headless Chromium DOM, actual original and candidate TypeScript compiled identically, 21 alternating paired batches, seeded bootstrap interval; complete measureDropGroups including layout reads. Not physical frame rate or complete pointer interaction.", results }, null, 2)}\n`,
  );
} finally {
  await browser.close();
}
