import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assembleSite,
  createPlan,
  MAX_PREVIEWS,
  prepareDeployment,
  publishComments,
  selectPreviews,
} from "./pages-previews.mjs";

const sha = "a".repeat(40);
const repository = "natanelia/panefold";
const context = { repo: { owner: "natanelia", repo: "panefold" }, payload: {} };
const pr = (number = 33, head = sha) => ({
  number,
  state: "open",
  base: { ref: "main" },
  head: { sha: head, repo: { full_name: repository } },
});
const plan = { repository, main: sha, previews: [{ number: 33, sha }] };
const core = () => ({
  outputs: {},
  notice() {},
  warning() {},
  setOutput(key, value) {
    this.outputs[key] = value;
  },
  summary: {
    addHeading() {
      return this;
    },
    addRaw() {
      return this;
    },
    addLink() {
      return this;
    },
    async write() {},
  },
});
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pages-preview-"));
  const { rm } = await import("node:fs/promises");
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

test("selects only open same-repository PRs against main, including drafts", () => {
  assert.deepEqual(
    selectPreviews(
      [
        pr(),
        { ...pr(34), draft: true },
        { ...pr(35), state: "closed" },
        { ...pr(36), head: { sha, repo: { full_name: "fork/panefold" } } },
        { ...pr(37), head: { sha, repo: null } },
        { ...pr(38), base: { ref: "other" } },
      ],
      repository,
    ),
    [
      { number: 33, sha },
      { number: 34, sha },
    ],
  );
});
test("rejects invalid numbers, refs and oversized build plans", () => {
  assert.throws(() => selectPreviews([pr("../33")], repository));
  assert.throws(() => selectPreviews([pr(33, "$(bad)")], repository));
  assert.throws(() =>
    selectPreviews(
      Array.from({ length: MAX_PREVIEWS + 1 }, (_, i) => pr(i + 1)),
      repository,
    ),
  );
});
test("plans immutable main and PR commit SHAs from API metadata", async () => {
  const c = core();
  const github = {
    rest: {
      repos: { getBranch: async () => ({ data: { commit: { sha } } }) },
      pulls: { list() {} },
    },
    paginate: async () => [pr()],
  };
  assert.deepEqual(await createPlan({ github, context, core: c }), plan);
  assert.equal(c.outputs["has-previews"], true);
  assert.deepEqual(JSON.parse(c.outputs.matrix), { include: plan.previews });
});
test("copies production unchanged and gives the PR its own assets and commit metadata", async (t) => {
  const f = await fixture(t);
  const manifest = await assembleSite(f);
  assert.equal(await readFile(join(f.output, "workbench/index.html"), "utf8"), "main workbench");
  assert.equal(
    await readFile(join(f.output, "previews/pr-33/workbench/assets/index.js"), "utf8"),
    "preview code",
  );
  assert.equal(manifest.previews[0].status, "ready");
  assert.equal(JSON.parse(await readFile(join(f.output, "previews/pr-33/preview.json"))).sha, sha);
  assert.match(
    await readFile(join(f.output, "previews/index.html"), "utf8"),
    /separate private browser window/u,
  );
});
test("closed previews are removed, including directories in a production artifact", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.incoming, "site-production/previews/pr-10"), { recursive: true });
  await writeFile(join(f.incoming, "site-production/previews/pr-10/index.html"), "old preview");
  const manifest = await assembleSite({ ...f, currentPreviews: [] });
  assert.deepEqual(manifest.previews, []);
  await assert.rejects(readFile(join(f.output, "previews/pr-33/index.html")), { code: "ENOENT" });
  await assert.rejects(readFile(join(f.output, "previews/pr-10/index.html")), { code: "ENOENT" });
});
test("a stale PR never publishes old code under a current preview URL", async (t) => {
  const f = await fixture(t);
  const manifest = await assembleSite({
    ...f,
    currentPreviews: [{ number: 33, sha: "b".repeat(40) }],
  });
  assert.equal(manifest.previews[0].status, "unavailable");
  await assert.rejects(readFile(join(f.output, "previews/pr-33/workbench/index.html")), {
    code: "ENOENT",
  });
});
test("a failed preview build leaves production deployable with an unavailable landing page", async (t) => {
  const f = await fixture(t);
  const { rm } = await import("node:fs/promises");
  await rm(join(f.incoming, "site-pr-33"), { recursive: true });
  assert.equal((await assembleSite(f)).previews[0].status, "unavailable");
  assert.equal(await readFile(join(f.output, "index.html"), "utf8"), "main homepage");
});
test("supports no open PRs without requiring a preview artifact", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(
    (await assembleSite({ ...f, plan: { ...plan, previews: [] }, currentPreviews: [] })).previews,
    [],
  );
});
test("rejects symbolic links, hard links and repository metadata from artifacts", async (t) => {
  for (const mode of ["symbolic", "hard", "metadata"]) {
    const f = await fixture(t);
    const target = join(f.incoming, "site-pr-33", mode === "metadata" ? ".git" : "link");
    if (mode === "symbolic") await symlink("../../site-production", target);
    else if (mode === "hard") await link(join(f.incoming, "site-pr-33/index.html"), target);
    else await mkdir(target);
    await assert.rejects(assembleSite(f));
  }
});
test("rejects wrong asset bases and missing production", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.incoming, "site-pr-33/index.html"),
    '<script src="/assets/index.js"></script>',
  );
  await assert.rejects(assembleSite(f), /Incorrect asset base/u);
  const empty = await fixture(t);
  const { rm } = await import("node:fs/promises");
  await rm(join(empty.incoming, "site-production/index.html"));
  await assert.rejects(assembleSite(empty), /Production index/u);
});
test("refuses to overwrite an output tree or destroy the input tree", async (t) => {
  const f = await fixture(t);
  await assert.rejects(assembleSite({ ...f, output: f.dir }));
  await assert.rejects(assembleSite({ ...f, output: f.incoming }));
  await assembleSite(f);
  await assert.rejects(assembleSite(f), /existing output/u);
});
test("does not deploy when main changed during a build", async () => {
  const c = core();
  const github = {
    rest: { repos: { getBranch: async () => ({ data: { commit: { sha: "b".repeat(40) } } }) } },
  };
  await prepareDeployment({ github, context, core: c, plan });
  assert.equal(c.outputs.deploy, "false");
});
test("posts one bot-owned preview link, updates it, and never edits user comments", async () => {
  const calls = [];
  let comments = [{ id: 1, user: { login: "natanelia" }, body: "<!-- panefold-pages-preview -->" }];
  const github = {
    rest: {
      pulls: { get: async () => ({ data: pr() }) },
      issues: {
        listComments() {},
        createComment: async (args) => calls.push(["create", args]),
        updateComment: async (args) => calls.push(["update", args]),
      },
    },
    paginate: async () => comments,
  };
  const args = {
    github,
    context,
    core: core(),
    manifest: { ...plan, previews: [{ number: 33, sha, status: "ready" }] },
    siteUrl: "https://natanelia.github.io/panefold/",
  };
  await publishComments(args);
  assert.equal(calls[0][0], "create");
  assert.match(calls[0][1].body, /previews\/pr-33\/workbench\//u);
  comments = [{ id: 2, user: { login: "github-actions[bot]" }, body: calls[0][1].body }];
  await publishComments(args);
  assert.equal(calls.length, 1);
  comments[0].body = "<!-- panefold-pages-preview --> old";
  await publishComments(args);
  assert.equal(calls[1][0], "update");
  assert.equal(calls[1][1].comment_id, 2);
});
test("does not post a ready link when the PR has changed or closed", async () => {
  const github = { rest: { pulls: { get: async () => ({ data: { ...pr(), state: "closed" } }) } } };
  await publishComments({
    github,
    context,
    core: core(),
    manifest: { ...plan, previews: [{ number: 33, sha, status: "ready" }] },
    siteUrl: "https://natanelia.github.io/panefold/",
  });
});
