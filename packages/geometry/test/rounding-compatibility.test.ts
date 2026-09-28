import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allocateAxis } from "../src/allocate-axis.js";
import { allocateAxis as referenceAllocateAxis } from "./reference/allocate-axis.js";
import type { AllocationItem } from "../src/types.js";

describe("lazy rounding compatibility with the unchanged baseline allocator", () => {
  it("preserves integer conservation, stable ties, fractional bounds, and emergency paths", () => {
    for (const sizes of [
      [0, 0],
      [1, 1],
      [0.1, 0.9],
      [1.1, 1.9],
      [100, 300],
    ]) {
      for (const available of [0, 1, 2, 3, 4, 5, 19, 100, 101, 1000]) {
        for (const max of [0, 1, 10, Number.POSITIVE_INFINITY]) {
          const items = sizes.map((min, index) => ({ key: `${index}`, constraints: { min, max } }));
          expect(allocateAxis(items, available)).toEqual(referenceAllocateAxis(items, available));
        }
      }
    }
  });

  it("matches all output arrays and diagnostics for 10000 seeded hostile allocations", () => {
    const dimension = fc.oneof(
      fc.integer({ min: -10, max: 4000 }).map((value) => value / 10),
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0),
    );
    const item = fc.record({
      weight: dimension,
      collapsed: fc.boolean(),
      constraints: fc.record({
        min: dimension,
        preferred: dimension,
        max: dimension,
        grow: dimension,
        shrink: dimension,
        collapsible: fc.boolean(),
        collapsePriority: dimension,
      }),
    });
    fc.assert(
      fc.property(
        fc.array(item, { maxLength: 24 }),
        dimension,
        dimension,
        (records, available, splitter) => {
          const items: AllocationItem[] = records.map((record, index) => ({
            ...record,
            key: `item:${index}`,
          }));
          expect(allocateAxis(items, available, splitter)).toEqual(
            referenceAllocateAxis(items, available, splitter),
          );
        },
      ),
      { seed: 20260927, numRuns: 10000 },
    );
  });
});
