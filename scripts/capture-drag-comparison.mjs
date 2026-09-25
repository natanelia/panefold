/** Record real pointer interactions from two built worktrees. Only captions/cursor are added. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const { values } = parseArgs({
  options: {
    "before-dir": { type: "string" },
    "output-dir": { type: "string" },
    "skip-build": { type: "boolean", default: false },
  },
});
assert.ok(values["before-dir"], "Supply --before-dir pointing to an installed baseline worktree");
const root = resolve(import.meta.dirname, "..");
const before = resolve(values["before-dir"]);
const output = resolve(values["output-dir"] ?? join(root, "docs/media"));
const temporary = await mkdtemp(join(tmpdir(), "panefold-drag-"));
await mkdir(output, { recursive: true });
const servers = [];
const viewport = { width: 1280, height: 800 };
const records = [];
const gitRef = (directory) =>
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
const refs = { before: gitRef(before), after: gitRef(root) };
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
  args: ["--no-sandbox", "--disable-webgl"],
});
try {
  for (const [variant, directory, port] of [
    ["before", before, 4317],
    ["after", root, 4318],
  ]) {
    if (!values["skip-build"])
      await run("pnpm", ["--filter", "@panefold/demo...", "build"], directory);
    const server = spawn(
      "pnpm",
      [
        "--filter",
        "@panefold/demo",
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--strictPort",
      ],
      { cwd: directory, stdio: "ignore", detached: true },
    );
    servers.push(server);
    await waitForUrl(`http://127.0.0.1:${port}`, server);
    const videos = [];
    for (const scenario of [
      "Tab insertion",
      "Split targets and modifier",
      "Whole-group center drop",
    ]) {
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        recordVideo: { dir: temporary, size: viewport },
      });
      const page = await context.newPage();
      try {
        await page.goto(`http://127.0.0.1:${port}`);
        await page.getByLabel("Panefold Code workbench").waitFor();
        await page.evaluate(
          ({ caption }) => {
            const banner = document.createElement("div");
            banner.textContent = caption;
            Object.assign(banner.style, {
              position: "fixed",
              bottom: "32px",
              left: "64px",
              zIndex: "2147483647",
              padding: "7px 10px",
              background: "#111e",
              color: "white",
              font: "12px/1.4 monospace",
              pointerEvents: "none",
            });
            const cursor = document.createElement("div");
            Object.assign(cursor.style, {
              position: "fixed",
              top: "0",
              left: "0",
              width: "13px",
              height: "13px",
              border: "2px solid white",
              borderRadius: "50%",
              boxShadow: "0 0 0 1px #111",
              zIndex: "2147483647",
              pointerEvents: "none",
              transform: "translate(-40px,-40px)",
            });
            document.addEventListener(
              "pointermove",
              (e) => {
                cursor.style.transform = `translate(${e.clientX - 7}px,${e.clientY - 7}px)`;
              },
              true,
            );
            document.body.append(banner, cursor);
          },
          { caption: `${variant.toUpperCase()} · ${refs[variant].slice(0, 8)} · ${scenario}` },
        );
        await delay(500);
        if (scenario === "Tab insertion") {
          const first = await rect(page, '[data-workspace-panel-tab="feature-inspector"]');
          const last = await rect(page, '[data-workspace-panel-tab="validation"]');
          await start(page, '[data-workspace-panel-tab="notes"]');
          await move(page, first.x + 3, first.y + first.height / 2);
          await record(page, variant, scenario, "before first tab");
          if (variant === "after") assert.equal(await kind(page), "tab-insert");
          await page.screenshot({ path: join(output, `vscode-drag-${variant}-tabs.png`) });
          await move(page, last.x + last.width - 3, last.y + last.height / 2);
          await record(page, variant, scenario, "after last tab");
          await move(page, first.x + 3, first.y + first.height / 2);
          await page.mouse.up();
          await delay(900);
        } else if (scenario === "Split targets and modifier") {
          const target = await rect(page, '[data-workspace-group="inspector"] .pf-panel-slot');
          await start(page, '[data-workspace-panel-tab="notes"]');
          for (const [x, y, label] of [
            [0.2, 0.5, "20% is center"],
            [0.02, 0.5, "left edge"],
            [0.5, 0.02, "top edge"],
            [0.98, 0.5, "right edge"],
            [0.5, 0.98, "bottom edge"],
          ]) {
            await move(page, target.x + target.width * x, target.y + target.height * y);
            await record(page, variant, scenario, label);
          }
          await page.keyboard.down("Alt");
          await delay(650);
          await record(page, variant, scenario, "stationary Alt: center");
          if (variant === "after") assert.equal(await kind(page), "center");
          await page.keyboard.up("Alt");
          await delay(500);
          await page.mouse.up();
          await delay(900);
        } else {
          const target = await rect(page, '[data-workspace-group="inspector"] .pf-panel-slot');
          await start(page, '[data-workspace-group-drag-handle="primary"]');
          await move(page, target.x + target.width / 2, target.y + target.height / 2);
          await record(page, variant, scenario, "center");
          if (variant === "after") assert.equal(await kind(page), "merge");
          await page.screenshot({ path: join(output, `vscode-drag-${variant}-group.png`) });
          await page.mouse.up();
          await delay(1200);
        }
        records.push({
          variant,
          scenario,
          result: await page.locator("[data-workspace-group]").evaluateAll((groups) =>
            groups.map((group) => ({
              group: group.getAttribute("data-workspace-group"),
              tabs: [...group.querySelectorAll("[data-workspace-panel-tab]")].map((tab) =>
                tab.getAttribute("data-workspace-panel-tab"),
              ),
            })),
          ),
        });
      } finally {
        await context.close();
      }
      const video = page.video();
      assert.ok(video);
      videos.push(await video.path());
    }
    assert.equal(server.exitCode, null, `Preview exited before ${variant} capture completed`);
    assert.equal(server.signalCode, null, `Preview was interrupted during ${variant} capture`);
    const list = join(temporary, `${variant}.txt`);
    await writeFile(
      list,
      videos.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join("\n"),
    );
    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list,
        "-filter_complex",
        "fps=12,scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3",
        "-loop",
        "0",
        join(output, `vscode-drag-${variant}.gif`),
      ],
      root,
    );
  }
  const files = await Promise.all(
    ["before", "after"].map(async (variant) => {
      const filename = `vscode-drag-${variant}.gif`;
      const bytes = await readFile(join(output, filename));
      return {
        filename,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }),
  );
  await writeFile(
    join(output, "vscode-drag-provenance.json"),
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        refs,
        browser: browser.version(),
        viewport,
        gif: { fps: 12, width: 1000 },
        annotation:
          "Only a cursor ring and revision/chapter caption were added; workspace rendering and pointer interactions are real.",
        records,
        files,
      },
      null,
      2,
    ) + "\n",
  );
  process.stdout.write(`Captured before/after GIFs in ${output}\n`);
} finally {
  await browser.close();
  for (const server of servers)
    if (server.pid !== undefined) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        /* already stopped */
      }
    }
}

async function rect(page, selector) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, `Missing ${selector}`);
  return box;
}
async function start(page, selector) {
  const box = await rect(page, selector);
  await page.mouse.move(box.x + Math.min(30, box.width / 2), box.y + box.height / 2);
  await page.mouse.down();
}
async function move(page, x, y) {
  await page.mouse.move(x, y, { steps: 18 });
  await delay(650);
}
async function kind(page) {
  return page
    .locator("[data-workspace-panel-drag], [data-workspace-group-drag]")
    .getAttribute("data-workspace-drop-kind");
}
async function record(page, variant, scenario, pose) {
  records.push({
    variant,
    scenario,
    pose,
    feedback: await page
      .locator("[data-workspace-panel-drag], [data-workspace-group-drag]")
      .evaluate((element) => ({
        kind: element.getAttribute("data-workspace-drop-kind"),
        edge: element.getAttribute("data-workspace-drop-edge"),
        target: element.getAttribute("data-workspace-drop-target"),
      })),
  });
}
async function waitForUrl(url, server) {
  for (let attempt = 0; attempt < 120; attempt++) {
    assert.equal(server.exitCode, null, `Preview exited before serving ${url}`);
    assert.equal(server.signalCode, null, `Preview was interrupted before serving ${url}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* starting */
    }
    await delay(250);
  }
  throw new Error(`Preview did not start: ${url}`);
}
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}
