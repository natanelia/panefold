import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  allocateAxis,
  normalizeItem,
  roundConserving,
  type NormalizedItem,
} from "../src/allocate-axis.js";
import { allocateAxis as archivedAllocateAxis } from "./reference/allocate-axis.js";

/** Enumerate feasible integer allocations; no remainder sorting is used. */
function leastSquaredRoundingError(
  values: readonly number[],
  items: readonly NormalizedItem[],
  target: number,
): number {
  let best = Number.POSITIVE_INFINITY;
  function visit(index: number, remaining: number, error: number): void {
    const item = items[index];
    if (item === undefined) {
      if (remaining === 0) best = Math.min(best, error);
      return;
    }
    const min = Math.ceil(item.min - 1e-9);
    const max = Math.min(remaining, Math.floor(item.max + 1e-9));
    for (let size = min; size <= max; size += 1) {
      visit(index + 1, remaining - size, error + (size - (values[index] ?? 0)) ** 2);
    }
  }
  visit(0, target, 0);
  return best;
}

describe("bounded integer rounding", () => {
  it("does not award another remainder pixel to a child already rounded up to its minimum", () => {
    const items = [
      { key: "minimum", weight: 939, constraints: { min: 93.9 } },
      { key: "first", weight: 36 },
      { key: "second", weight: 25 },
    ];

    expect(archivedAllocateAxis(items, 100).sizes).toEqual([95, 3, 2]);
    expect(allocateAxis(items, 100).sizes).toEqual([94, 4, 2]);
  });

  it("keeps stable child-order ties after fractional minima consume a pixel", () => {
    expect(
      allocateAxis(
        [
          { key: "minimum", weight: 919, constraints: { min: 91.9 } },
          { key: "first", weight: 27 },
          { key: "second", weight: 27 },
          { key: "third", weight: 27 },
        ],
        100,
      ).sizes,
    ).toEqual([92, 3, 3, 2]);
  });

  it("minimizes rounding error among feasible integer allocations with fractional bounds", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            weight: fc.integer({ min: 1, max: 30 }),
            atMinimum: fc.boolean(),
            extra: fc.integer({ min: 0, max: 2 }),
          }),
          { minLength: 2, maxLength: 4 },
        ),
        fc.integer({ min: 1, max: 20 }),
        (records, target) => {
          const weightTotal = records.reduce((total, item) => total + item.weight, 0);
          const values = records.map((item) => (target * item.weight) / weightTotal);
          const items = records.map((record, index) => {
            const value = values[index] ?? 0;
            return normalizeItem(
              {
                key: String(index),
                constraints: {
                  min: record.atMinimum ? value : Math.max(0, Math.floor(value) - 1),
                  max: Math.ceil(value) + record.extra / 2,
                },
              },
              index,
              [],
            );
          });
          fc.pre(items.reduce((total, item) => total + Math.ceil(item.min - 1e-9), 0) <= target);
          const sizes = roundConserving(values, items, target, false, false);
          const error = sizes.reduce(
            (total, size, index) => total + (size - (values[index] ?? 0)) ** 2,
            0,
          );
          expect(sizes.reduce((total, size) => total + size, 0)).toBe(target);
          sizes.forEach((size, index) => {
            const item = items[index];
            if (item === undefined) throw new RangeError("Missing generated rounding item.");
            expect(size).toBeGreaterThanOrEqual(Math.ceil(item.min - 1e-9));
            expect(size).toBeLessThanOrEqual(Math.floor(item.max + 1e-9));
          });
          expect(error).toBeCloseTo(leastSquaredRoundingError(values, items, target), 8);
        },
      ),
      { seed: 20261109, numRuns: 2500 },
    );
  });
});
