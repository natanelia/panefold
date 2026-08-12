import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const siteDist = resolve(root, "apps/site/dist");
const expectedSiteDist = `${resolve(root, "apps/site")}/dist`;

if (siteDist !== expectedSiteDist) {
  throw new Error(`Refusing to clean unexpected site output: ${siteDist}`);
}

await rm(siteDist, { recursive: true, force: true });
