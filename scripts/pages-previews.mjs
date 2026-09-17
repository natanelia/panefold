/** Trusted Pages orchestration. Do not execute code from a preview artifact here. */
import assert from "node:assert/strict";
import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const MAX_PREVIEWS = 20;
const MAX_FILES = 20_000;
const MAX_BYTES = 800 * 1024 * 1024;
const MARKER = "<!-- panefold-pages-preview -->";
const SHA = /^[a-f0-9]{40}$/u;

export function selectPreviews(pulls, repository) {
  const selected = pulls.filter(
    (pr) => pr.state === "open" && pr.base.ref === "main" && pr.head.repo?.full_name === repository,
  );
  // Never silently remove a live preview when the configured build budget is exceeded.
  assert.ok(
    selected.length <= MAX_PREVIEWS,
    `More than ${MAX_PREVIEWS} open previews; raise the budget explicitly`,
  );
  return selected
    .map((pr) => {
      assert.ok(Number.isSafeInteger(pr.number) && pr.number > 0);
      assert.match(pr.head.sha, SHA);
      return { number: pr.number, sha: pr.head.sha };
    })
    .sort((a, b) => a.number - b.number);
}

export async function createPlan({ github, context, core }) {
  const { data: branch } = await github.rest.repos.getBranch({ ...context.repo, branch: "main" });
  const pulls = await github.paginate(github.rest.pulls.list, {
    ...context.repo,
    base: "main",
    state: "open",
    per_page: 100,
  });
  assert.match(branch.commit.sha, SHA);
  const plan = {
    repository: `${context.repo.owner}/${context.repo.repo}`,
    main: branch.commit.sha,
    previews: selectPreviews(pulls, `${context.repo.owner}/${context.repo.repo}`),
  };
  core.setOutput("main", plan.main);
  core.setOutput("has-previews", plan.previews.length > 0);
  core.setOutput("matrix", JSON.stringify({ include: plan.previews }));
  core.setOutput("plan", JSON.stringify(plan));
  await core.summary
    .addHeading("Demo previews")
    .addRaw(
      `Build production from main ${plan.main}. Build ${plan.previews.length} same-repository previews. Forks are excluded.`,
    )
    .write();
  return plan;
}

async function copyStaticTree(source, destination, budget) {
  const root = await lstat(source);
  assert.ok(root.isDirectory() && !root.isSymbolicLink(), `Not a static directory: ${source}`);
  await mkdir(destination, { recursive: true });
  for (const name of (await readdir(source)).sort()) {
    assert.ok(![".git", ".github"].includes(name), `Repository metadata in artifact: ${name}`);
    const from = join(source, name);
    const to = join(destination, name);
    const entry = await lstat(from);
    assert.ok(!entry.isSymbolicLink(), `Symbolic link in artifact: ${name}`);
    if (entry.isDirectory()) await copyStaticTree(from, to, budget);
    else {
      assert.ok(entry.isFile() && entry.nlink === 1, `Non-regular file in artifact: ${name}`);
      budget.files += 1;
      budget.bytes += entry.size;
      assert.ok(
        budget.files <= MAX_FILES && budget.bytes <= MAX_BYTES,
        "Pages artifact exceeds the deployment budget",
      );
      await copyFile(from, to);
    }
  }
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function page(title, content) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(title)}</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:800px;margin:48px auto;padding:0 24px}code{overflow-wrap:anywhere}li{margin:16px 0}a{color:#075bb5}</style></head>
<body><main><h1>${escapeHtml(title)}</h1>${content}</main></body></html>\n`;
}

export async function assembleSite({ plan, currentPreviews, incoming, output }) {
  assert.match(plan.main, SHA);
  assert.match(plan.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u);
  assert.ok(plan.previews.length <= MAX_PREVIEWS);
  const root = resolve(output);
  // Output is a fresh sibling directory, never an input tree or the runner checkout.
  const inputs = resolve(incoming);
  assert.ok(root !== inputs && !inputs.startsWith(`${root}/`) && !root.startsWith(`${inputs}/`));
  assert.ok(!(await exists(root)), "Refuse to replace an existing output directory");
  const production = join(inputs, "site-production");
  assert.ok(await exists(join(production, "index.html")), "Production index is missing");
  const budget = { files: 0, bytes: 0 };
  await copyStaticTree(production, root, budget);
  // Only this trusted assembler owns /previews; never retain stale directories.
  await rm(join(root, "previews"), { recursive: true, force: true });
  await mkdir(join(root, "previews"));
  const current = new Map(currentPreviews.map((pr) => [pr.number, pr.sha]));
  const published = [];
  for (const preview of plan.previews) {
    assert.ok(Number.isSafeInteger(preview.number) && preview.number > 0);
    assert.match(preview.sha, SHA);
    if (!current.has(preview.number)) continue; // Closed PR: remove, never re-publish it.
    const dir = `pr-${preview.number}`;
    const destination = join(root, "previews", dir);
    await mkdir(destination);
    const source = join(inputs, `site-pr-${preview.number}`);
    const ready =
      current.get(preview.number) === preview.sha && (await exists(join(source, "index.html")));
    if (ready) {
      await copyStaticTree(source, join(destination, "workbench"), budget);
      const html = await readFile(join(destination, "workbench/index.html"), "utf8");
      const base = `/${plan.repository.split("/")[1]}/previews/${dir}/workbench/`;
      assert.ok(html.includes(`${base}assets/`), `Incorrect asset base for PR #${preview.number}`);
    }
    const item = { ...preview, status: ready ? "ready" : "unavailable" };
    published.push(item);
    await writeFile(join(destination, "preview.json"), `${JSON.stringify(item, null, 2)}\n`);
    const link = `https://github.com/${plan.repository}/pull/${preview.number}`;
    await writeFile(
      join(destination, "index.html"),
      page(
        `Panefold PR #${preview.number}`,
        `
<p><a href="${link}">Pull request</a> · Commit <code>${preview.sha}</code></p>
${ready ? '<p><a href="workbench/">Open preview workbench</a></p>' : "<p>This preview is unavailable. The build failed or the PR changed during the build. Check GitHub Actions.</p>"}
<p>This is a test build, not the main demo. Use a separate private browser window: demos on this site share browser storage.</p>
<p><a href="../">All previews</a> · <a href="../../workbench/">Main demo</a></p>`,
      ),
    );
  }
  await writeFile(
    join(root, "previews/index.html"),
    page(
      "Panefold pull request previews",
      `
<p>Open a preview to test a pull request before merge. Each page identifies the built commit.</p>
<ul>${published.map((pr) => `<li><a href="pr-${pr.number}/">PR #${pr.number}</a> · <code>${pr.sha.slice(0, 7)}</code> · ${pr.status}</li>`).join("")}</ul>
${published.length ? "" : "<p>No previews are available.</p>"}
<p>Use a separate private browser window. Preview code runs on the same origin and shares browser storage with the main demo.</p>
<p><a href="../workbench/">Main demo</a></p>`,
    ),
  );
  const manifest = { ...plan, previews: published };
  await writeFile(join(root, "previews/index.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function prepareDeployment({ github, context, core, plan, incoming, output }) {
  const { data: main } = await github.rest.repos.getBranch({ ...context.repo, branch: "main" });
  if (main.commit.sha !== plan.main) {
    core.notice("Main changed during the build. A newer run must deploy the site.");
    core.setOutput("deploy", "false");
    return;
  }
  const pulls = await github.paginate(github.rest.pulls.list, {
    ...context.repo,
    base: "main",
    state: "open",
    per_page: 100,
  });
  const manifest = await assembleSite({
    plan,
    currentPreviews: selectPreviews(pulls, plan.repository),
    incoming,
    output,
  });
  core.setOutput("manifest", JSON.stringify(manifest));
  core.setOutput("deploy", "true");
}

export async function publishComments({ github, context, core, manifest, siteUrl }) {
  const url = new URL(siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`);
  assert.equal(url.protocol, "https:");
  for (const preview of manifest.previews) {
    const { data: pr } = await github.rest.pulls.get({
      ...context.repo,
      pull_number: preview.number,
    });
    if (
      pr.state !== "open" ||
      pr.head.sha !== preview.sha ||
      pr.head.repo?.full_name !== manifest.repository
    )
      continue;
    const previewUrl = new URL(`previews/pr-${preview.number}/`, url).href;
    const body = `${MARKER}\n### Demo preview\n\n${preview.status === "ready" ? `[Open preview workbench](${previewUrl}workbench/)` : `Preview unavailable. [Build status](${previewUrl})`}\n\nCommit: \`${preview.sha}\`. [All previews](${new URL("previews/", url).href}).\n\nUse a separate private browser window. Previews share this site's browser storage.\n\nThis link updates after PR pushes and is removed when the PR closes.`;
    const comments = await github.paginate(github.rest.issues.listComments, {
      ...context.repo,
      issue_number: pr.number,
      per_page: 100,
    });
    const previous = comments.find(
      (comment) =>
        comment.user?.login === "github-actions[bot]" && comment.body?.startsWith(MARKER),
    );
    if (previous?.body === body) continue;
    try {
      if (previous)
        await github.rest.issues.updateComment({ ...context.repo, comment_id: previous.id, body });
      else
        await github.rest.issues.createComment({ ...context.repo, issue_number: pr.number, body });
    } catch (error) {
      if (![403, 404].includes(error.status)) throw error;
      core.warning(
        `Could not post the preview comment for PR #${pr.number}. See the Pages run summary.`,
      );
    }
  }
  const closed = context.payload.action === "closed" ? context.payload.pull_request : undefined;
  if (closed?.head.repo?.full_name === manifest.repository) {
    const comments = await github.paginate(github.rest.issues.listComments, {
      ...context.repo,
      issue_number: closed.number,
      per_page: 100,
    });
    const previous = comments.find(
      (comment) =>
        comment.user?.login === "github-actions[bot]" && comment.body?.startsWith(MARKER),
    );
    if (previous)
      await github.rest.issues.updateComment({
        ...context.repo,
        comment_id: previous.id,
        body: `${MARKER}\nPreview removed because this pull request is closed. [Main demo](${new URL("workbench/", url).href}).`,
      });
  }
  await core.summary
    .addHeading("Published demo previews")
    .addLink("All previews", new URL("previews/", url).href)
    .write();
}
