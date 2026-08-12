import { spawn } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const demo = start([
  "--filter",
  "@panefold/demo",
  "run",
  "dev",
  "--",
  "--host",
  "127.0.0.1",
  "--port",
  "4317",
]);
const site = start(["--filter", "@panefold/site", "run", "dev", "--", "--host", "127.0.0.1"], {
  PANEFOLD_SITE_DEV_PROXY: "true",
});

const signals = ["SIGINT", "SIGTERM"];
for (const signal of signals) {
  process.once(signal, () => {
    stop(signal);
  });
}

const exitCode = await Promise.race([exitOf(demo), exitOf(site)]);
stop("SIGTERM");
process.exitCode = exitCode;

function start(arguments_, environment = {}) {
  return spawn("pnpm", arguments_, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...environment },
  });
}

function exitOf(child) {
  return new Promise((resolveExit) => {
    child.once("error", () => resolveExit(1));
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
}

function stop(signal) {
  if (!demo.killed) demo.kill(signal);
  if (!site.killed) site.kill(signal);
}
