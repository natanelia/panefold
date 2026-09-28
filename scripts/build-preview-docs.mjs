/** Build nested documentation inside the already-supported unprivileged PR workbench artifact.
 * Production builds are untouched. The trusted main-branch Pages assembler still controls deploys.
 */
import { execFileSync } from "node:child_process";
import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { previewSiteBase } from "./site-catalog.mjs";

const base = previewSiteBase(process.env.PANEFOLD_DEMO_BASE);
if (base !== undefined) {
  const root = resolve(import.meta.dirname, "..");
  const nested = resolve(root, "apps/demo/dist/site");
  // Do not recursively copy an earlier nested site into its own demo.
  await rm(nested, { recursive: true, force: true });
  execFileSync("pnpm", ["--filter", "@panefold/site", "run", "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PANEFOLD_SITE_BASE: base },
  });
  await cp(resolve(root, "apps/site/dist"), nested, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
}
