import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  allocateAxis,
  allocateProportionally,
  normalizeItem,
  type NormalizedItem,
} from "../src/allocate-axis.js";
import type { AllocationItem } from "../src/types.js";
import { allocateAxis as archivedAllocateAxis } from "./reference/allocate-axis.js";

/** Independent scalar search; deliberately does not freeze a pending set. */
function proportionalOracle(
  items: readonly NormalizedItem[],
  target: number,
  lowerFor: (item: NormalizedItem) => number,
  upperFor: (item: NormalizedItem) => number,
  factorFor: (item: NormalizedItem) => number,
): number[] {
  let factors = items.map(factorFor);
  if (Math.max(...factors) <= 1e-9) factors = factors.map(() => 1);
  const positiveCapacity = items.reduce(
    (total, item, index) => total + ((factors[index] ?? 0) > 0 ? upperFor(item) : lowerFor(item)),
    0,
  );
  const zeroFactorsGrow = positiveCapacity < target;
  const fixed = items.map((item, index) => {
    const positive = (factors[index] ?? 0) > 0;
    return zeroFactorsGrow
      ? positive
        ? upperFor(item)
        : undefined
      : positive
        ? undefined
        : lowerFor(item);
  });
  const valuesAt = (scale: number) =>
    items.map(
      (item, index) =>
        fixed[index] ??
        Math.min(
          upperFor(item),
          Math.max(lowerFor(item), scale * (zeroFactorsGrow ? 1 : (factors[index] ?? 0))),
        ),
    );
  let low = 0;
  let high = 1;
  while (valuesAt(high).reduce((total, value) => total + value, 0) < target - 1e-9) high *= 2;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const middle = (low + high) / 2;
    const total = valuesAt(middle).reduce((sum, value) => sum + value, 0);
    if (total < target) low = middle;
    else high = middle;
  }
  return valuesAt((low + high) / 2);
}

describe("bounded proportional allocation", () => {
  it("releases apparent lower bounds when a maximum frees the remaining space", () => {
    const items: AllocationItem[] = [
      { key: "capped", weight: 9, constraints: { max: 20 } },
      { key: "first", weight: 1, constraints: { min: 15, max: 60 } },
      { key: "second", weight: 1, constraints: { min: 15, max: 60 } },
    ];

    // Keep the original failure reproducible: the archived algorithm consumes
    // the budget during one pass and incorrectly freezes both equal siblings.
    expect(archivedAllocateAxis(items, 100).sizes).toEqual([20, 20, 60]);
    expect(allocateAxis(items, 100).sizes).toEqual([20, 40, 40]);
    expect(allocateAxis([...items.slice(2), ...items.slice(0, 2)], 100).sizes).toEqual([
      40, 20, 40,
    ]);
  });

  it("releases an apparent maximum when a minimum consumes the remaining space", () => {
    const items: AllocationItem[] = [
      { key: "capped", weight: 4, constraints: { max: 30 } },
      { key: "minimum", weight: 1, constraints: { min: 60 } },
      { key: "flexible", weight: 5 },
    ];

    expect(archivedAllocateAxis(items, 100).sizes).toEqual([30, 60, 10]);
    expect(allocateAxis(items, 100).sizes).toEqual([18, 60, 22]);
  });

  it("keeps jointly feasible fractional preferences as proportional floors", () => {
    const result = allocateAxis(
      [
        { key: "a", weight: 9, constraints: { min: 5.2, preferred: 12.9, max: 21.2, grow: 4 } },
        { key: "b", weight: 6, constraints: { min: 18.1, preferred: 25.9, max: 51.1, grow: 3 } },
        { key: "c", weight: 3, constraints: { min: 19.8, preferred: 29.3, max: 45.8, grow: 2 } },
      ],
      72,
    );

    expect(result.sizes).toEqual([17, 26, 29]);
    expect(result.diagnostics).toEqual([]);
  });

  it("distributes the remainder equally among zero factors after positive factors reach maxima", () => {
    expect(
      allocateAxis(
        [
          { key: "capped", constraints: { max: 20 } },
          { key: "first", constraints: { min: 10, max: 100, grow: 0 } },
          { key: "second", constraints: { min: 10, max: 100, grow: 0 } },
        ],
        100,
      ).sizes,
    ).toEqual([20, 40, 40]);
  });

  it("matches an independent scalar search for fractional bounds and zero factors", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            min: fc.integer({ min: 0, max: 500 }),
            extra: fc.integer({ min: 0, max: 1500 }),
            preferredOffset: fc.integer({ min: 0, max: 1500 }),
            weight: fc.integer({ min: 1, max: 200 }),
            grow: fc.integer({ min: 0, max: 20 }),
            shrink: fc.integer({ min: 1, max: 20 }),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        fc.integer({ min: 0, max: 100 }),
        fc.boolean(),
        (records, fraction, preferencesFit) => {
          const items = records.map((record, index) =>
            normalizeItem(
              {
                key: `item:${index}`,
                weight: record.weight / 10,
                constraints: {
                  min: record.min / 10,
                  max: (record.min + record.extra) / 10,
                  preferred: (record.min + record.preferredOffset) / 10,
                  grow: record.grow / 10,
                  shrink: record.shrink / 10,
                },
              },
              index,
              [],
            ),
          );
          const lowerFor = (item: NormalizedItem) => (preferencesFit ? item.preferred : item.min);
          const upperFor = (item: NormalizedItem) => item.max;
          const factorFor = (item: NormalizedItem) =>
            preferencesFit ? item.weight * item.grow : item.weight / item.shrink;
          const lowerTotal = items.reduce((total, item) => total + lowerFor(item), 0);
          const upperTotal = items.reduce((total, item) => total + upperFor(item), 0);
          const target = lowerTotal + ((upperTotal - lowerTotal) * fraction) / 100;
          const actual = allocateProportionally(items, target, lowerFor, upperFor, factorFor);
          const expected = proportionalOracle(items, target, lowerFor, upperFor, factorFor);

          expect(actual.reduce((total, value) => total + value, 0)).toBeCloseTo(target, 7);
          actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index] ?? NaN, 7));

          if (items.length > 1) {
            const movedFactorFor = (item: NormalizedItem) =>
              factorFor(item) * (item.index === 0 ? 1.1 : item.index === 1 ? 0.9 : 1);
            const moved = allocateProportionally(items, target, lowerFor, upperFor, movedFactorFor);
            expect((moved[0] ?? NaN) + 1e-7).toBeGreaterThanOrEqual(actual[0] ?? NaN);
          }
        },
      ),
      { seed: 20261108, numRuns: 3000 },
    );
  });
});
