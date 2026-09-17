/** Check the assembled Pages artifact on localhost. This script never deploys it. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export function validateManifest(manifest, expected, expectedPr, expectedSha) {
  assert.deepEqual(manifest, expected, "The artifact must match the trusted assembly manifest");
  assert.match(manifest.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u);
  assert.match(manifest.main, /^[a-f0-9]{40}$/u);
  assert.ok(Array.isArray(manifest.previews));
  const seen = new Set();
  for (const preview of manifest.previews) {
    assert.ok(Number.isSafeInteger(preview.number) && preview.number > 0);
    assert.ok(!seen.has(preview.number), "Duplicate preview number");
    seen.add(preview.number);
    assert.match(preview.sha, /^[a-f0-9]{40}$/u);
    assert.ok(["ready", "unavailable"].includes(preview.status));
  }
  if (expectedPr) {
    const preview = manifest.previews.find((entry) => entry.number === Number(expectedPr));
    assert.ok(preview, "The current PR must be present in the assembled site");
    assert.equal(preview.sha, expectedSha, "The current PR commit must be tested");
    assert.equal(preview.status, "ready", "The current PR preview must build successfully");
  }
  return `/${manifest.repository.split("/")[1]}/`;
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

export async function servePreview(directory, prefix) {
  assert.match(prefix, /^\/[A-Za-z0-9_.-]+\/$/u);
  const root = await realpath(directory);
  const server = createServer(async (request, response) => {
    try {
      if (!["GET", "HEAD"].includes(request.method)) {
        response.writeHead(405).end();
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      assert.ok(pathname.startsWith(prefix));
      const file = await realpath(
        resolve(
          root,
          pathname.slice(prefix.length),
          ...(pathname.endsWith("/") ? ["index.html"] : []),
        ),
      );
      const path = relative(root, file);
      assert.ok(path !== ".." && !path.startsWith(`..${sep}`));
      assert.ok((await stat(file)).isFile());
      const body = await readFile(file);
      response.writeHead(200, {
        "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function main() {
  const directory = resolve(process.argv[2] ?? "published");
  const manifest = JSON.parse(await readFile(resolve(directory, "previews/index.json"), "utf8"));
  const prefix = validateManifest(
    manifest,
    JSON.parse(process.env.PREVIEW_MANIFEST),
    process.env.EXPECTED_PR,
    process.env.EXPECTED_SHA,
  );
  const { chromium } = await import("@playwright/test");
  let browser;
  const results = [];
  await mkdir("artifacts", { recursive: true });
  const { server, origin } = await servePreview(directory, prefix);
  try {
    browser = await chromium.launch();
    const targets = [
      { label: "main", sha: manifest.main, path: "workbench/", status: "ready" },
      ...manifest.previews.map((entry) => ({
        ...entry,
        label: `pr-${entry.number}`,
        path: `previews/pr-${entry.number}/workbench/`,
      })),
    ];
    for (const target of targets) {
      const url = `${origin}${prefix}${target.path}`;
      if (target.status === "unavailable") {
        assert.equal(
          (await fetch(url)).status,
          404,
          "Unavailable previews must not serve old code",
        );
        assert.equal((await fetch(new URL("../", url))).status, 200);
        results.push({ ...target, checked: "unavailable page only" });
        continue;
      }
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("response", (response) => {
          if (response.url().startsWith(origin) && response.status() >= 400) {
            errors.push(`${response.status()} ${response.url()}`);
          }
        });
        assert.equal((await page.goto(url)).status(), 200);
        await page.locator(".pf-workspace").first().waitFor({ state: "visible" });
        await page.locator("[data-workspace-panel-tab]").first().waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        await page.screenshot({ path: `artifacts/pages-${target.label}.png` });
        assert.deepEqual(errors, [], `${target.label} must load without page or asset errors`);
        results.push({ ...target, checked: "workbench loaded", errors });
        process.stdout.write(`PASS ${target.label} ${target.sha}\n`);
      } finally {
        await context.close();
      }
    }
    await writeFile(
      "artifacts/pages-preview-validation.json",
      `${JSON.stringify({ scope: "local artifact, not a live deployment", manifest, results }, null, 2)}\n`,
    );
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
