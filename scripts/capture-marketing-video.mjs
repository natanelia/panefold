import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, "apps/site/public/media");
const captureDirectory = await mkdtemp(join(tmpdir(), "panefold-capture-"));
const framesDirectory = resolve(captureDirectory, "frames");
await mkdir(framesDirectory, { recursive: true });
await mkdir(outputDirectory, { recursive: true });

await run("pnpm", ["--filter", "@panefold/demo...", "run", "build"], root);
const preview = spawn(
  "pnpm",
  ["--filter", "@panefold/demo", "preview", "--host", "127.0.0.1", "--port", "4317"],
  { cwd: root, stdio: "ignore" },
);

try {
  await waitForUrl("http://127.0.0.1:4317");
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "/tmp/chromium";
  const browser = await chromium.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-webgl"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await page.goto("http://127.0.0.1:4317", { waitUntil: "networkidle" });
  await page.getByLabel("Map operations workspace").waitFor();
  await page.evaluate(() => {
    const style = globalThis.document.createElement("style");
    style.textContent = `
      #panefold-film-pointer {
        position: fixed; left: 0; top: 0; z-index: 2147483647; width: 18px; height: 18px;
        border: 2px solid #a5f3fc; border-radius: 999px; pointer-events: none;
        box-shadow: 0 0 0 4px rgb(8 145 178 / 20%), 0 3px 16px rgb(0 0 0 / 55%);
        transform: translate3d(-40px, -40px, 0); transition: transform 220ms cubic-bezier(.2,.8,.2,1);
      }
      #panefold-film-pointer::after {
        position: absolute; inset: -8px; border: 1px solid #67e8f9; border-radius: inherit;
        opacity: 0; content: "";
      }
      #panefold-film-pointer.pulse::after { animation: panefold-film-pulse 420ms ease-out; }
      #panefold-film-chapter {
        position: fixed; right: 18px; top: 62px; z-index: 2147483646; padding: 7px 10px;
        border: 1px solid rgb(103 232 249 / 25%); border-radius: 7px;
        color: #cffafe; background: rgb(7 12 18 / 88%); font: 600 10px/1.2 ui-monospace, monospace;
        letter-spacing: .09em; text-transform: uppercase; pointer-events: none;
      }
      @keyframes panefold-film-pulse { from { opacity: .8; transform: scale(.55); } to { opacity: 0; transform: scale(1.45); } }
    `;
    const pointer = globalThis.document.createElement("div");
    pointer.id = "panefold-film-pointer";
    const chapter = globalThis.document.createElement("div");
    chapter.id = "panefold-film-chapter";
    chapter.textContent = "Atlas · semantic interaction";
    globalThis.document.head.append(style);
    globalThis.document.body.append(pointer, chapter);
  });

  let recording = true;
  let frame = 0;
  const capture = (async () => {
    while (recording) {
      const started = performance.now();
      await page.screenshot({
        path: resolve(framesDirectory, `frame-${String(frame).padStart(5, "0")}.jpg`),
        type: "jpeg",
        quality: 82,
        animations: "allow",
      });
      frame += 1;
      const remaining = 50 - (performance.now() - started);
      if (remaining > 0) await delay(remaining);
    }
  })();

  await delay(900);
  const splitter = page.getByRole("separator").nth(1);
  await cue(splitter, "Resize · transient preview");
  await splitter.focus();
  await splitter.press("Shift+ArrowRight");
  await delay(450);
  await splitter.press("Shift+ArrowRight");
  await delay(800);

  const notesTab = page.getByRole("tab", { name: "Notes" });
  await cue(notesTab, "Select · semantic command");
  await notesTab.click();
  await delay(700);
  const actionsButton = page.getByRole("button", { name: "Actions for Notes" });
  await cue(actionsButton, "Move · stable panel host");
  await actionsButton.click();
  await delay(500);
  const moveItem = page.getByRole("menuitem", { name: /Move to Problems and activity/i });
  await cue(moveItem, "Commit · one transaction");
  await moveItem.click();
  await delay(1100);

  const closeButton = page.getByRole("button", { name: "Close Notes" });
  await cue(closeButton, "Close · recoverable structure");
  await closeButton.click();
  await delay(900);
  const undoButton = page.getByRole("button", { name: "Undo layout change" });
  await cue(undoButton, "Undo · restore once");
  await undoButton.click();
  await delay(1100);

  await page.keyboard.press("Control+K");
  await delay(1000);
  await page.keyboard.press("Escape");
  await delay(700);

  recording = false;
  await capture;
  await browser.close();

  const files = await readdir(framesDirectory);
  if (files.length < 20) throw new Error(`Expected at least 20 frames, captured ${files.length}`);
  await run(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      "20",
      "-i",
      resolve(framesDirectory, "frame-%05d.jpg"),
      "-c:v",
      "libvpx-vp9",
      "-crf",
      "36",
      "-b:v",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-an",
      resolve(outputDirectory, "panefold-interactions.webm"),
    ],
    root,
  );
  await run(
    "ffmpeg",
    [
      "-y",
      "-ss",
      "00:00:02.4",
      "-i",
      resolve(outputDirectory, "panefold-interactions.webm"),
      "-frames:v",
      "1",
      "-q:v",
      "2",
      resolve(outputDirectory, "panefold-interactions-poster.jpg"),
    ],
    root,
  );
  process.stdout.write(`Captured ${files.length} frames to apps/site/public/media\n`);

  async function cue(locator, label) {
    const bounds = await locator.boundingBox();
    if (bounds === null) return;
    await page.evaluate(
      ({ x, y, nextLabel }) => {
        const pointer = globalThis.document.getElementById("panefold-film-pointer");
        const chapter = globalThis.document.getElementById("panefold-film-chapter");
        if (pointer !== null) {
          pointer.style.transform = `translate3d(${String(x - 9)}px, ${String(y - 9)}px, 0)`;
          pointer.classList.remove("pulse");
          void pointer.offsetWidth;
          pointer.classList.add("pulse");
        }
        if (chapter !== null) chapter.textContent = nextLabel;
      },
      { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, nextLabel: label },
    );
    await delay(280);
  }
} finally {
  preview.kill("SIGTERM");
  await rm(captureDirectory, { recursive: true, force: true });
}

async function waitForUrl(url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await globalThis.fetch(url);
      if (response.ok) return;
    } catch {
      // The preview server is still starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function run(command, arguments_, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, arguments_, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with code ${String(code)}`));
    });
  });
}
