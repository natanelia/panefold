/** Read-only deployment check. Never mistake an older successful preview for this PR's build. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

const { PREVIEW_NUMBER: number, PREVIEW_SHA: sha } = process.env;
assert.match(number ?? "", /^[1-9][0-9]*$/u);
assert.match(sha ?? "", /^[a-f0-9]{40}$/u);
const base = `https://natanelia.github.io/panefold/previews/pr-${number}/`;
let lastResult = "No response";
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await fetch(`${base}preview.json?audit=${sha}-${attempt}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) {
      const manifest = await response.json();
      lastResult = JSON.stringify(manifest);
      if (manifest.sha === sha && manifest.status === "ready") {
        const page = await fetch(`${base}workbench/site/workbench/?fixture=touch`, {
          signal: AbortSignal.timeout(5_000),
        });
        assert.equal(page.status, 200, "The nested playground must be deployed too");
        assert.match(await page.text(), /<script[^>]+src=/u);
        await writeFile(
          "artifacts/hosted-revision.json",
          `${JSON.stringify(
            {
              ...manifest,
              verifiedAt: new Date().toISOString(),
              url: `${base}workbench/site/workbench/?fixture=touch`,
            },
            null,
            2,
          )}\n`,
        );
        process.stdout.write(`Verified deployed PR ${number} at ${sha}\n`);
        process.exit(0);
      }
    } else lastResult = `HTTP ${response.status}`;
  } catch (error) {
    lastResult = String(error);
  }
  await setTimeout(5_000);
}
throw new Error(`The expected preview was not deployed: ${sha}. Last response: ${lastResult}`);
