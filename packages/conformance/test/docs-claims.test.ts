import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const checker = resolve(repositoryRoot, "scripts/check-docs-claims.mjs");

function runChecker(document?: string) {
  return spawnSync(
    process.execPath,
    [checker, ...(document === undefined ? [] : ["--document", document])],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 10_000,
    },
  );
}

describe("published conformance claims", () => {
  it("matches the canonical trace and result data", () => {
    const result = runChecker();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Documentation claims match 380 trace cells");
  });

  it("rejects trace-total drift", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "panefold-docs-claims-"));
    try {
      const source = await readFile(resolve(repositoryRoot, "docs/CONFORMANCE.md"), "utf8");
      const drifted = source.replace(
        /(trace cells currently\s+contain\s+)(\d+)/,
        (_claim, prefix: string, verified: string) => `${prefix}${String(Number(verified) - 1)}`,
      );
      expect(drifted).not.toBe(source);
      const document = resolve(temporaryDirectory, "CONFORMANCE.md");
      await writeFile(document, drifted, "utf8");

      const result = runChecker(document);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Documentation claim drift for trace totals");
      expect(result.stderr).toContain("expected");
      expect(result.stderr).toContain("received");
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
