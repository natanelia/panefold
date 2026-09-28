import test from "node:test";
import assert from "node:assert/strict";
import { readSiteCatalog, previewSiteBase } from "./site-catalog.mjs";

test("one catalog preserves reference routes and resolves every guide source", async () => {
  const routes = await readSiteCatalog();
  assert.equal(routes.length, new Set(routes.map((route) => route.path)).size);
  for (const path of [
    "docs/quickstart",
    "docs/tabs",
    "docs/persistence",
    "docs/performance",
    "docs/system-design",
    "docs/adr-post-commit-effects",
  ])
    assert.ok(
      routes.some((route) => route.path === path),
      path,
    );
  assert.ok(routes.length >= 38);
});
test("nested documentation is opt-in only for an exact PR workbench base", () => {
  assert.equal(
    previewSiteBase("/panefold/previews/pr-42/workbench/"),
    "/panefold/previews/pr-42/workbench/site/",
  );
  for (const value of [
    undefined,
    "",
    "/",
    "/panefold/workbench/",
    "/panefold/previews/pr-0/workbench/",
    "/panefold/previews/pr-42/workbench",
    "https://example.com/previews/pr-42/workbench/",
    "/../previews/pr-42/workbench/",
    "/panefold/previews/pr-42/workbench/;echo bad",
  ])
    assert.equal(previewSiteBase(value), undefined);
});
