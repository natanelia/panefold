import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { canonicalSerialize } from "@panefold/kernel";
import { createWorkspaceSnapshot, revision, type JsonValue } from "@panefold/model";
import { createWorkspaceEnvelope, decodeWorkspaceEnvelope } from "../src/persistence-codec";
import { createWorkspaceEnvelope as original } from "./reference-persistence-codec";

const utf16 = fc
  .array(fc.integer({ min: 0, max: 65535 }), { maxLength: 150 })
  .map((units) => String.fromCharCode(...units));
describe("canonical envelope serialization reuse", () => {
  it("preserves exact serialized bytes through parse and canonical reserialization", () => {
    fc.assert(
      fc.property(fc.jsonValue(), utf16, fc.bigInt(), (value, text, counter) => {
        const input = { value, text, counter, "2": -0, "10": 1e21, optional: undefined };
        const serialized = canonicalSerialize(input);
        expect(canonicalSerialize(JSON.parse(serialized))).toBe(serialized);
      }),
      { seed: 20260928, numRuns: 10000 },
    );
  });
  it("returns identical complete envelopes and exact digest input for 1000 seeded workspaces", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.jsonValue(),
        utf16,
        fc.bigInt({ min: 0n, max: (1n << 96n) - 1n }),
        async (value, text, counter) => {
          const snapshot = createWorkspaceSnapshot({
            revision: revision(counter),
            metadata: { value: value as JsonValue, text, "2": -0, "10": 1e21 },
          });
          const checksum = {
            async digest(serialized: string) {
              return serialized;
            },
          };
          const expected = await original(snapshot, { checksum });
          const actual = await createWorkspaceEnvelope(snapshot, { checksum });
          expect(actual).toEqual(expected);
          expect(actual.checksum).toBe(canonicalSerialize(actual.workspace));
          expect(Object.isFrozen(actual)).toBe(true);
          expect(Object.isFrozen(actual.panelTypeVersions)).toBe(true);
        },
      ),
      { seed: 20260928, numRuns: 1000 },
    );
  });
  it("preserves real SHA-256 and decode round trips for string and number edge cases", async () => {
    for (const text of ["", "中文🙂\ud800\udfff", '"\\\n\0', "x".repeat(50000)]) {
      const snapshot = createWorkspaceSnapshot({
        metadata: { text, "10": -0, "2": Number.MAX_VALUE },
      });
      const expected = await original(snapshot);
      const actual = await createWorkspaceEnvelope(snapshot);
      expect(actual).toEqual(expected);
      const decoded = await decodeWorkspaceEnvelope(actual, {
        currentKernelSchemaVersion: 2,
        currentApplicationLayoutVersion: 1,
        currentProtocolVersion: 1,
      });
      expect(decoded.ok).toBe(true);
      if (decoded.ok)
        expect(canonicalSerialize(decoded.snapshot)).toBe(canonicalSerialize(snapshot));
    }
  });
  it("rejects invalid versions and workspaces before invoking the digest", async () => {
    const digest = vi.fn(async () => "unexpected");
    const checksum = { digest };
    const snapshot = createWorkspaceSnapshot();
    await expect(
      createWorkspaceEnvelope(snapshot, { protocolVersion: 0, checksum }),
    ).rejects.toMatchObject({ code: "INVALID_ENVELOPE" });
    const invalid = { ...snapshot, schemaVersion: 0 };
    await expect(createWorkspaceEnvelope(invalid, { checksum })).rejects.toMatchObject({
      code: "INVALID_WORKSPACE",
    });
    expect(digest).not.toHaveBeenCalled();
  });
  it("preserves checksum provider rejection", async () => {
    const error = new Error("digest failed");
    const checksum = {
      digest: vi.fn(async () => {
        throw error;
      }),
    };
    await expect(createWorkspaceEnvelope(createWorkspaceSnapshot(), { checksum })).rejects.toBe(
      error,
    );
    expect(checksum.digest).toHaveBeenCalledTimes(1);
  });
});
