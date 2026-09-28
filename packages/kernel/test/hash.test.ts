import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createWorkspaceSnapshot, revision, type WorkspaceSnapshot } from "@panefold/model";
import { canonicalHash, canonicalSerialize, semanticHash } from "../src/hash";
import { fixtureSnapshot } from "./fixtures";

// Deliberately retain the pre-optimization BigInt algorithm as an independent
// arithmetic oracle. Neither word multiplication nor carry logic is shared.
function referenceHash(value: unknown): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(canonicalSerialize(value))) {
    hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `fnv1a64-v1:${hash.toString(16).padStart(16, "0")}`;
}

function checkBoth(snapshot: WorkspaceSnapshot): void {
  expect(canonicalHash(snapshot)).toBe(referenceHash(snapshot));
  const { revision: _revision, ...semanticState } = snapshot;
  void _revision;
  expect(semanticHash(snapshot)).toBe(referenceHash(semanticState));
}

describe("word-based FNV-1a compatibility", () => {
  it("preserves fingerprints of empty and populated workspaces", () => {
    checkBoth(createWorkspaceSnapshot());
    checkBoth(fixtureSnapshot());
  });

  it("preserves UTF-8, escaped characters, and unpaired surrogate behavior", () => {
    for (const text of [
      "",
      "\0",
      '"\\\n\r\t',
      "é中文🙂",
      "\ud800",
      "\udfff",
      "a\ud800b\udfff",
      String.fromCharCode(...Array.from({ length: 256 }, (_, index) => index)),
      "\uffff🙂\0".repeat(32_768),
    ]) {
      checkBoth(createWorkspaceSnapshot({ metadata: { text } }));
    }
  });

  it("matches BigInt arithmetic across seeded random UTF-16 inputs and revisions", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 65_535 }), { maxLength: 256 }),
        fc.bigInt({ min: 0n, max: (1n << 96n) - 1n }),
        (units, counter) => {
          checkBoth(
            createWorkspaceSnapshot({
              revision: revision(counter),
              metadata: { text: String.fromCharCode(...units), number: -0, truth: true, nil: null },
            }),
          );
        },
      ),
      { seed: 20260927, numRuns: 2_000 },
    );
  });

  it("excludes only the revision from semantic fingerprints", () => {
    const first = fixtureSnapshot();
    const second = { ...first, revision: revision(first.revision + 1n) };
    expect(semanticHash(first)).toBe(semanticHash(second));
    expect(canonicalHash(first)).not.toBe(canonicalHash(second));
    checkBoth(second);
  });
});
