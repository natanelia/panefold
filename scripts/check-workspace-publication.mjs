import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const packagesRoot = resolve(repositoryRoot, "packages");
const directories = (await readdir(packagesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

const failures = [];
for (const directory of directories) {
  const manifestPath = resolve(packagesRoot, directory.name, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (typeof manifest.name !== "string" || !manifest.name.startsWith("@panefold/")) {
    failures.push(`${directory.name}: expected an @panefold package name.`);
  }
  if (manifest.private !== true) {
    failures.push(
      `${directory.name}: workspace-only packages must remain private until an audited publication workflow exists.`,
    );
  }
}

if (failures.length > 0) {
  failures.forEach((failure) => process.stderr.write(`${failure}\n`));
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Publication boundary verified for ${String(directories.length)} private workspace packages.\n`,
  );
}
