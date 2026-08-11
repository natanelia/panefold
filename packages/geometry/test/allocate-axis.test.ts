import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { allocateAxis } from "../src/index.js";
import type { AllocationItem } from "../src/index.js";

describe("allocateAxis", () => {
  it("uses stable largest-remainder ties and conserves every pixel", () => {
    const result = allocateAxis(
      [
        { key: "a", weight: 1 },
        { key: "b", weight: 1 },
        { key: "c", weight: 1 },
      ],
      10,
    );

    expect(result.sizes).toEqual([4, 3, 3]);
    expect(result.splitterSizes).toEqual([0, 0]);
    expect(result.diagnostics).toEqual([]);
  });

  it("water-fills around minima, preferences, and maxima", () => {
    const result = allocateAxis(
      [
        {
          key: "fixed",
          constraints: { min: 20, preferred: 30, max: 30, grow: 1 },
        },
        {
          key: "flex",
          constraints: { min: 10, preferred: 20, max: 100, grow: 3 },
        },
      ],
      80,
      4,
    );

    expect(result.sizes).toEqual([30, 46]);
    expect(result.splitterSizes).toEqual([4]);
    expect(result.diagnostics).toEqual([]);
  });

  it("collapses the lowest-priority eligible child before violating hard minima", () => {
    const result = allocateAxis(
      [
        { key: "a", constraints: { min: 50 } },
        { key: "b", constraints: { min: 50, collapsible: true, collapsePriority: 0 } },
        { key: "c", constraints: { min: 50, collapsible: true, collapsePriority: 1 } },
      ],
      103,
      3,
    );

    expect(result.collapsedKeys).toEqual(["b"]);
    expect(result.activeIndices).toEqual([0, 2]);
    expect(result.sizes).toEqual([50, 0, 50]);
    expect(result.splitterSizes).toEqual([3]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["CHILD_COLLAPSED"]);
  });

  it("reports explicit emergency paths while preserving exact non-negative geometry", () => {
    const hardMinimum = allocateAxis(
      [
        { key: "a", constraints: { min: 100 } },
        { key: "b", constraints: { min: 100 } },
      ],
      51,
      1,
    );
    const maximum = allocateAxis(
      [
        { key: "a", constraints: { max: 10 } },
        { key: "b", constraints: { max: 10 } },
      ],
      51,
      1,
    );

    expect(hardMinimum.sizes).toEqual([25, 25]);
    expect(
      hardMinimum.diagnostics.some((diagnostic) => diagnostic.code === "HARD_MIN_VIOLATED"),
    ).toBe(true);
    expect(maximum.sizes).toEqual([25, 25]);
    expect(maximum.diagnostics.some((diagnostic) => diagnostic.code === "MAX_VIOLATED")).toBe(true);
  });

  it("is deterministic and exactly conserving for arbitrary valid inputs", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            min: fc.integer({ min: 0, max: 200 }),
            preferred: fc.integer({ min: 0, max: 300 }),
            max: fc.integer({ min: 0, max: 400 }),
            weight: fc.integer({ min: 1, max: 20 }),
            grow: fc.integer({ min: 0, max: 20 }),
            shrink: fc.integer({ min: 0, max: 20 }),
            collapsible: fc.boolean(),
            collapsePriority: fc.integer({ min: 0, max: 10 }),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        fc.integer({ min: 0, max: 2_000 }),
        fc.integer({ min: 0, max: 20 }),
        (records, available, splitterSize) => {
          const items: AllocationItem[] = records.map((record, index) => ({
            key: `item-${index}`,
            weight: record.weight,
            constraints: {
              min: record.min,
              preferred: record.preferred,
              max: record.max,
              grow: record.grow,
              shrink: record.shrink,
              collapsible: record.collapsible,
              collapsePriority: record.collapsePriority,
            },
          }));
          const first = allocateAxis(items, available, splitterSize);
          const second = allocateAxis(items, available, splitterSize);

          expect(second).toEqual(first);
          expect(
            first.sizes.reduce((total, size) => total + size, 0) +
              first.splitterSizes.reduce((total, size) => total + size, 0),
          ).toBe(available);
          expect(first.sizes.every((size) => Number.isInteger(size) && size >= 0)).toBe(true);
          expect(first.splitterSizes.every((size) => Number.isInteger(size) && size >= 0)).toBe(
            true,
          );
        },
      ),
      { numRuns: 2_000 },
    );
  });

  it("respects integer min/max bounds whenever they are jointly feasible", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            min: fc.integer({ min: 0, max: 50 }),
            extra: fc.integer({ min: 0, max: 100 }),
            preferredOffset: fc.integer({ min: 0, max: 100 }),
            grow: fc.integer({ min: 1, max: 10 }),
            shrink: fc.integer({ min: 1, max: 10 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        fc.integer({ min: 0, max: 100 }),
        (records, selector) => {
          const normalized = records.map((record, index) => {
            const max = record.min + record.extra;
            return {
              key: `item-${index}`,
              constraints: {
                min: record.min,
                max,
                preferred: Math.min(max, record.min + record.preferredOffset),
                grow: record.grow,
                shrink: record.shrink,
              },
            } satisfies AllocationItem;
          });
          const minimum = normalized.reduce(
            (total, item) => total + (item.constraints?.min ?? 0),
            0,
          );
          const maximum = normalized.reduce(
            (total, item) => total + (item.constraints?.max ?? 0),
            0,
          );
          const available = minimum + Math.floor(((maximum - minimum) * selector) / 100);
          const result = allocateAxis(normalized, available);

          result.sizes.forEach((size, index) => {
            const item = normalized[index];
            if (item === undefined) throw new RangeError("Missing generated allocation item.");
            expect(size).toBeGreaterThanOrEqual(item.constraints.min);
            expect(size).toBeLessThanOrEqual(item.constraints.max);
          });
          expect(result.diagnostics).toEqual([]);
        },
      ),
      { numRuns: 1_000 },
    );
  });
});
