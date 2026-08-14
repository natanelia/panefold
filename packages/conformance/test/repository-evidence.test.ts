import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { verifyRepositoryEvidence } from "../../../scripts/verify-repository-evidence.mjs";

describe("repository result evidence", () => {
  it("verifies the result artifact and every declared source digest", async () => {
    const fixture = await createFixture();
    try {
      expect(await verifyRepositoryEvidence(fixture.evidence, { root: fixture.root })).toEqual([]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects nested source drift even when the result artifact digest remains valid", async () => {
    const fixture = await createFixture();
    try {
      await writeFile(join(fixture.root, "source.ts"), "export const value = 2;\n", "utf8");

      const failures = await verifyRepositoryEvidence(fixture.evidence, { root: fixture.root });

      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain("Result source digest mismatch for current-result (source.ts)");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("requires source digests unless a historical result is exempted explicitly", async () => {
    const root = await mkdtemp(join(tmpdir(), "panefold-repository-evidence-"));
    try {
      const result = `${JSON.stringify({ schemaVersion: 1 }, null, 2)}\n`;
      await writeFile(join(root, "result.json"), result, "utf8");
      const evidence = [
        {
          id: "legacy-result",
          status: "verified",
          artifactRole: "result",
          uri: "repo://result.json",
          sha256: digest(result),
        },
      ] as const;

      expect(await verifyRepositoryEvidence(evidence, { root })).toEqual([
        "Result sourceDigests for legacy-result must be a non-empty JSON object.",
      ]);
      expect(
        await verifyRepositoryEvidence(evidence, {
          root,
          allowMissingResultSourceDigestIds: ["legacy-result"],
        }),
      ).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an independent semantic result that omits the reviewed source closure", async () => {
    const fixture = await createFixture();
    try {
      const evidence = fixture.evidence.map((record) => ({
        ...record,
        id: "independent-semantic-oracle-result",
      }));

      expect(await verifyRepositoryEvidence(evidence, { root: fixture.root })).toContain(
        "Result sourceDigests for independent-semantic-oracle-result must bind the exact reviewed source closure.",
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "panefold-repository-evidence-"));
  const source = "export const value = 1;\n";
  await writeFile(join(root, "source.ts"), source, "utf8");
  const result = `${JSON.stringify(
    {
      schemaVersion: 1,
      sourceDigests: { "source.ts": digest(source) },
    },
    null,
    2,
  )}\n`;
  await writeFile(join(root, "result.json"), result, "utf8");
  return {
    root,
    evidence: [
      {
        id: "current-result",
        status: "verified",
        artifactRole: "result",
        uri: "repo://result.json",
        sha256: digest(result),
      },
    ],
  } as const;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
