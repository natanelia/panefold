import { describe, expect, it } from "vitest";

import { PersistentBucketMap } from "../src/index";

describe("PersistentBucketMap", () => {
  it("copies only changed buckets and leaves prior versions immutable", () => {
    const initial = PersistentBucketMap.from<Readonly<{ value: number }>>(
      [
        ["alpha", Object.freeze({ value: 1 })],
        ["beta", Object.freeze({ value: 2 })],
      ],
      16,
    );
    const next = initial.withChanges([
      { type: "set", key: "alpha", value: Object.freeze({ value: 3 }) },
    ]);

    expect(initial.get("alpha")).toEqual({ value: 1 });
    expect(next.get("alpha")).toEqual({ value: 3 });
    expect(next.sharedBucketCount(initial)).toBe(15);
    expect(Object.isFrozen(next.bucketIdentity(0))).toBe(true);
  });

  it("returns the same version for semantic no-op updates", () => {
    const value = Object.freeze({ value: 1 });
    const initial = PersistentBucketMap.from([["alpha", value]], 8);
    expect(initial.withChanges([{ type: "set", key: "alpha", value }])).toBe(initial);
    expect(initial.withChanges([{ type: "delete", key: "missing" }])).toBe(initial);
  });

  it("applies colliding changes in one bucket clone", () => {
    const initial = PersistentBucketMap.empty<number>(4);
    const next = initial.withChanges(
      Array.from({ length: 20 }, (_, index) => ({
        type: "set" as const,
        key: `key:${index}`,
        value: index,
      })),
    );
    expect(next.size).toBe(20);
    expect(next.entries()).toHaveLength(20);
    expect(next.sharedBucketCount(initial)).toBe(0);
  });

  it("retains explicitly stored undefined values in iteration", () => {
    const map = PersistentBucketMap.from<undefined>([["present", undefined]], 4);
    expect(map.has("present")).toBe(true);
    expect(map.entries()).toEqual([["present", undefined]]);
  });
});
