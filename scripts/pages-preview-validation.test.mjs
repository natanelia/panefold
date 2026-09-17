import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assembleSite } from "./pages-previews.mjs";

const sha = "a".repeat(40);
const plan = { repository: "natanelia/panefold", main: sha, previews: [{ number: 33, sha }] };

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pages-validation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const incoming = join(dir, "incoming");
  await mkdir(join(incoming, "site-production/workbench"), { recursive: true });
  await writeFile(join(incoming, "site-production/index.html"), "main homepage");
  await writeFile(join(incoming, "site-production/workbench/index.html"), "main workbench");
  await mkdir(join(incoming, "site-pr-33/assets"), { recursive: true });
  await writeFile(
    join(incoming, "site-pr-33/index.html"),
    '<script src="/panefold/previews/pr-33/workbench/assets/index.js"></script>',
  );
  await writeFile(join(incoming, "site-pr-33/assets/index.js"), "preview code");
  return { plan, currentPreviews: plan.previews, incoming, output: join(dir, "published"), dir };
}

test("validation rejects missing, failed, stale, and untrusted current-PR artifacts", async () => {
  const { validateManifest } = await import("./pages-preview-smoke.mjs");
  const ready = { ...plan, previews: [{ number: 33, sha, status: "ready" }] };
  assert.equal(validateManifest(ready, ready, "33", sha), "/panefold/");
  const failed = { ...plan, previews: [{ number: 33, sha, status: "unavailable" }] };
  assert.throws(() => validateManifest(failed, failed, "33", sha), /successfully/u);
  assert.throws(() => validateManifest(ready, ready, "34", sha), /present/u);
  assert.throws(() => validateManifest(ready, ready, "33", "b".repeat(40)), /commit/u);
  assert.throws(() => validateManifest(ready, failed, "33", sha), /trusted/u);
  const duplicate = { ...ready, previews: [...ready.previews, ...ready.previews] };
  assert.throws(() => validateManifest(duplicate, duplicate, "33", sha), /Duplicate/u);
});

test("the local smoke server uses the production base and rejects paths outside the artifact", async (t) => {
  const { servePreview } = await import("./pages-preview-smoke.mjs");
  const f = await fixture(t);
  await assembleSite(f);
  await writeFile(join(f.dir, "outside.html"), "private");
  await symlink(join(f.dir, "outside.html"), join(f.output, "escape.html"));
  const { server, origin } = await servePreview(f.output, "/panefold/");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  });
  const get = (path) => fetch(`${origin}${path}`);
  assert.equal(await (await get("/panefold/workbench/")).text(), "main workbench");
  assert.equal((await get("/panefold/previews/pr-33/workbench/assets/index.js")).status, 200);
  assert.equal((await get("/panefold/escape.html")).status, 404);
  assert.equal((await get("/panefold/%2e%2e%2foutside.html")).status, 404);
  assert.equal((await get("/workbench/")).status, 404);
  assert.equal((await get("/panefold/%ZZ")).status, 404);
  assert.equal((await fetch(`${origin}/panefold/`, { method: "POST" })).status, 405);
});

test("branch validation cannot call the protected deployment workflow or request write permissions", async () => {
  for (const name of ["pages-build", "pages-preview-validation"]) {
    const workflow = await readFile(
      new URL(`../.github/workflows/${name}.yml`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(workflow, /\benvironment:|\bsecrets:|:\s*write\b/u);
    assert.doesNotMatch(workflow, /actions\/deploy-pages|uses:.*\/pages\.yml/u);
  }
  const validation = await readFile(
    new URL("../.github/workflows/pages-preview-validation.yml", import.meta.url),
    "utf8",
  );
  assert.match(validation, /uses: \.\/\.github\/workflows\/pages-build\.yml/u);
  assert.match(validation, /run: node scripts\/pages-preview-smoke\.mjs published/u);
  assert.match(validation, /artifact-ids: \$\{\{ needs\.build\.outputs\.artifact-id \}\}/u);
});

test("live deployment requires the main run ref and the assembled artifact ID", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/pages.yml", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(workflow, /workflow_call:|\n  pull_request:/u);
  const deploy = workflow.split("\n  deploy:\n")[1]?.split("\n  links:\n")[0];
  assert.ok(deploy);
  assert.match(deploy, /if:.*github\.ref == 'refs\/heads\/main'/u);
  assert.match(deploy, /needs\.build\.result == 'success'/u);
  assert.match(deploy, /needs\.build\.outputs\.ready == 'true'/u);
  assert.match(deploy, /name: github-pages/u);
  assert.match(deploy, /artifact-ids: \$\{\{ needs\.build\.outputs\.artifact-id \}\}/u);
  assert.match(deploy, /actions\/deploy-pages@/u);
});

test("an optional failed preview cannot upload an artifact or hide a current-PR failure", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/pages-build.yml", import.meta.url),
    "utf8",
  );
  const previews = workflow.split("\n  previews:\n")[1]?.split("\n  assemble:\n")[0];
  assert.ok(previews);
  assert.doesNotMatch(previews, /\n    continue-on-error:/u);
  assert.match(previews, /id: build\n        if: steps\.install\.outcome == 'success'/u);
  assert.match(
    previews,
    /uses: actions\/upload-artifact@[^\n]+\n        if: steps\.build\.outcome == 'success'/u,
  );
  assert.match(previews, /::warning::PR/u);
  const { validateManifest } = await import("./pages-preview-smoke.mjs");
  const unavailable = { ...plan, previews: [{ number: 33, sha, status: "unavailable" }] };
  assert.throws(() => validateManifest(unavailable, unavailable, "33", sha), /successfully/u);
});
