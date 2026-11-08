import { normalizeSplitWeights } from "@panefold/model";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  allocateAxis,
  createAxisResizePlan,
  getAxisResizeBounds,
  resizeAxis,
  type AllocationItem,
} from "../src/index.js";

function canonicalItems(items: readonly AllocationItem[]): AllocationItem[] {
  const weights = normalizeSplitWeights(items.map((item) => item.weight ?? 1));
  return items.map((item, index) => ({ ...item, weight: weights[index] ?? 1 }));
}

function replay(items: readonly AllocationItem[], weights: readonly number[], size: number) {
  expect(normalizeSplitWeights(weights)).toEqual(weights);
  return allocateAxis(
    items.map((item, index) => ({ ...item, weight: weights[index] ?? 1 })),
    size,
  );
}

describe("constraint-aware axis resizing", () => {
  it("moves an adjacent pair in pixels without moving its third constrained sibling", () => {
    const items = canonicalItems(
      [1, 1, 1].map((weight, index) => ({
        key: String(index),
        weight,
        constraints: { min: 100 },
      })),
    );
    const plan = createAxisResizePlan(items, 988);
    const before = plan.allocation.sizes[0] ?? 0;
    const unchanged = plan.allocation.sizes[2];
    const weights = resizeAxis(plan, 0, 1, before + 100);
    expect(replay(items, weights, 988).sizes).toEqual([
      before + 100,
      988 - before - 100 - (unchanged ?? 0),
      unchanged,
    ]);
    const bounds = getAxisResizeBounds(plan, 0, 1);
    expect(bounds.minBeforeSize).toBe(100);
    expect(bounds.maxBeforeSize).toBe(
      (plan.allocation.sizes[0] ?? 0) + (plan.allocation.sizes[1] ?? 0) - 100,
    );
  });

  it.each([
    { name: "growth", constraints: [{ grow: 2 }, { grow: 1 }, { grow: 1 }] },
    {
      name: "shrinkage",
      constraints: [
        { preferred: 500, shrink: 1 },
        { preferred: 500, shrink: 2 },
        { preferred: 500, shrink: 1 },
      ],
    },
  ])("inverts unequal $name factors and supports reversing a resize", ({ constraints }) => {
    let items = canonicalItems(
      constraints.map((item, index) => ({ key: String(index), constraints: item })),
    );
    const original = allocateAxis(items, 988).sizes;
    const first = createAxisResizePlan(items, 988);
    const weights = resizeAxis(first, 0, 1, (original[0] ?? 0) + 70);
    const preview = replay(items, weights, 988);
    expect(preview.sizes).toEqual([(original[0] ?? 0) + 70, (original[1] ?? 0) - 70, original[2]]);
    items = items.map((item, index) => ({ ...item, weight: weights[index] ?? 1 }));
    const second = createAxisResizePlan(items, 988);
    expect(replay(items, resizeAxis(second, 0, 1, original[0] ?? 0), 988).sizes).toEqual(original);
  });

  it("keeps semantic and emergency-collapsed weights and sizes unchanged", () => {
    const items = canonicalItems([
      { key: "left", constraints: { min: 100, grow: 2 } },
      { key: "hidden", collapsed: true, weight: 4, constraints: { min: 300 } },
      { key: "right", constraints: { min: 100 } },
    ]);
    const plan = createAxisResizePlan(items, 700);
    const weights = resizeAxis(plan, 0, 2, 350);
    expect(weights[1]).toBe(items[1]?.weight);
    expect(replay(items, weights, 700).sizes).toEqual([350, 0, 350]);
  });

  it("reports fixed limits for infeasible hard minima and zero-growth panes", () => {
    for (const items of [
      canonicalItems([
        { key: "a", constraints: { min: 100 } },
        { key: "b", constraints: { min: 100 } },
      ]),
      canonicalItems([{ key: "a", constraints: { grow: 0 } }, { key: "b" }]),
    ]) {
      const plan = createAxisResizePlan(items, 150);
      const size = plan.allocation.sizes[0] ?? 0;
      expect(getAxisResizeBounds(plan, 0, 1)).toMatchObject({
        minBeforeSize: size,
        maxBeforeSize: size,
      });
      expect(resizeAxis(plan, 0, 1, 0)).toEqual(items.map((item) => item.weight));
      expect(resizeAxis(plan, 0, 1, 150)).toEqual(items.map((item) => item.weight));
    }
  });

  it("uses reachable canonical-weight endpoints for extreme factors", () => {
    const items = canonicalItems([{ key: "a", constraints: { grow: 1e9 } }, { key: "b" }]);
    const plan = createAxisResizePlan(items, 1000);
    const minimum = allocateAxis(
      [
        { ...items[0], key: "a", weight: 1 },
        { ...items[1], key: "b", weight: 999_999 },
      ],
      1000,
    ).sizes[0];
    const maximum = allocateAxis(
      [
        { ...items[0], key: "a", weight: 999_999 },
        { ...items[1], key: "b", weight: 1 },
      ],
      1000,
    ).sizes[0];
    const bounds = getAxisResizeBounds(plan, 0, 1);
    expect(bounds.minBeforeSize).toBe(minimum);
    expect(bounds.maxBeforeSize).toBe(maximum);
    expect(replay(items, resizeAxis(plan, 0, 1, bounds.minBeforeSize), 1000).sizes[0]).toBe(
      minimum,
    );
    expect(replay(items, resizeAxis(plan, 0, 1, bounds.maxBeforeSize), 1000).sizes[0]).toBe(
      maximum,
    );
  });

  it.each([
    {
      name: "an inactive shrink floor",
      available: 993,
      before: 1,
      after: 2,
      items: [
        {
          key: "a",
          weight: 421739,
          constraints: { min: 132, max: 443, preferred: 414, grow: 0.1, shrink: 5 },
        },
        {
          key: "b",
          weight: 243478,
          constraints: { min: 191, max: 597, preferred: 480, grow: 13, shrink: 0.2 },
        },
        {
          key: "c",
          weight: 30435,
          constraints: { min: 30, max: 235, preferred: 46, grow: 1, shrink: 5 },
        },
        {
          key: "d",
          weight: 304348,
          constraints: { min: 9, max: 137, preferred: 120, grow: 0, shrink: 1e6 },
        },
      ],
    },
    {
      name: "a collapsed sibling and disparate growth factors",
      available: 1022,
      before: 1,
      after: 3,
      items: [
        {
          key: "a",
          weight: 257143,
          constraints: { min: 65.4, max: 376.4, preferred: 267.4, grow: 7, shrink: 5 },
        },
        {
          key: "b",
          weight: 254286,
          constraints: { min: 15, max: 316, preferred: 259, grow: 1e6, shrink: 1 },
        },
        {
          key: "c",
          weight: 274286,
          collapsed: true,
          constraints: { min: 197.6, max: 356.6, preferred: 451.6, grow: 0.1, shrink: 5 },
        },
        {
          key: "d",
          weight: 214285,
          constraints: { min: 75.2, max: 248.2, preferred: 199.2, grow: 1e6, shrink: 1 },
        },
      ],
    },
    {
      name: "a fractional preferred floor during emergency growth",
      available: 819,
      before: 1,
      after: 2,
      items: [
        {
          key: "a",
          weight: 313334,
          constraints: { min: 63.8, max: 184.8, preferred: 343.8, grow: 1, shrink: 0 },
        },
        {
          key: "b",
          weight: 253333,
          constraints: { min: 29.8, max: 140.8, preferred: 35.8, grow: 1, shrink: 5 },
        },
        {
          key: "c",
          weight: 433333,
          constraints: { min: 195, max: 372, preferred: 447, grow: 1e6, shrink: 1 },
        },
      ],
    },
  ])(
    "keeps repeated Home/End endpoints stable with $name",
    ({ items, available, before, after }) => {
      const plan = createAxisResizePlan(items, available, 6);
      for (const target of [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
        const weights = resizeAxis(plan, before, after, target);
        const nextItems = items.map((item, index) => ({ ...item, weight: weights[index] ?? 1 }));
        const nextPlan = createAxisResizePlan(nextItems, available, 6);
        const repeated = resizeAxis(nextPlan, before, after, target);
        const replayed = allocateAxis(
          nextItems.map((item, index) => ({ ...item, weight: repeated[index] ?? 1 })),
          available,
          6,
        );
        expect(replayed.sizes).toEqual(nextPlan.allocation.sizes);
        nextPlan.allocation.sizes.forEach((size, index) => {
          if (index !== before && index !== after) expect(size).toBe(plan.allocation.sizes[index]);
        });
      }
    },
  );

  it("captures caller-owned arrays and constraints before caching a gesture", () => {
    const inputs = [
      { key: "a", weight: 500_000, constraints: { min: 100 } },
      { key: "b", weight: 500_000, constraints: { min: 100 } },
    ];
    const allocation = allocateAxis(inputs, 1000, 6);
    const plan = createAxisResizePlan(inputs, 1000, 6, allocation);
    expect(getAxisResizeBounds(plan, 0, 1).minBeforeSize).toBe(100);
    inputs[0]!.constraints.min = 450;
    inputs[0]!.weight = 900_000;
    (allocation.sizes as number[])[0] = 450;
    const weights = resizeAxis(plan, 0, 1, Number.NEGATIVE_INFINITY);
    const replayed = allocateAxis(
      plan.items.map((item, index) => ({ ...item, weight: weights[index] ?? 1 })),
      1000,
      6,
    );
    expect(replayed.sizes).toEqual([100, 894]);
    expect(plan.allocation.sizes).toEqual([497, 497]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.items[0]?.constraints)).toBe(true);
  });

  it("preserves every unrelated pixel and reaches ordinary integer bounds", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            min: fc.integer({ min: 0, max: 70 }),
            extra: fc.integer({ min: 1, max: 300 }),
            preferredExtra: fc.integer({ min: 0, max: 100 }),
            weight: fc.integer({ min: 1, max: 20 }),
            grow: fc.integer({ min: 1, max: 10 }),
            shrink: fc.integer({ min: 1, max: 10 }),
          }),
          { minLength: 2, maxLength: 6 },
        ),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (records, availableSelector, pairSelector, targetSelector) => {
          const items = canonicalItems(
            records.map((record, index) => ({
              key: String(index),
              weight: record.weight,
              constraints: {
                min: record.min,
                max: record.min + record.extra,
                preferred: record.min + Math.min(record.extra, record.preferredExtra),
                grow: record.grow,
                shrink: record.shrink,
              },
            })),
          );
          const minimum = records.reduce((total, item) => total + item.min, 0);
          const maximum = records.reduce((total, item) => total + item.min + item.extra, 0);
          const available = minimum + Math.floor(((maximum - minimum) * availableSelector) / 100);
          const plan = createAxisResizePlan(items, available);
          const beforeIndex = pairSelector % (items.length - 1);
          const afterIndex = beforeIndex + 1;
          const beforeSize = plan.allocation.sizes[beforeIndex] ?? 0;
          const afterSize = plan.allocation.sizes[afterIndex] ?? 0;
          const preferencesFit =
            items.reduce((total, item) => total + (item.constraints?.preferred ?? 0), 0) <=
            available;
          const beforeConstraint = items[beforeIndex]?.constraints;
          const afterConstraint = items[afterIndex]?.constraints;
          const min = Math.max(
            (preferencesFit ? beforeConstraint?.preferred : beforeConstraint?.min) ?? 0,
            beforeSize + afterSize - (afterConstraint?.max ?? Infinity),
          );
          const max = Math.min(
            beforeConstraint?.max ?? Infinity,
            beforeSize +
              afterSize -
              ((preferencesFit ? afterConstraint?.preferred : afterConstraint?.min) ?? 0),
          );
          const bounds = getAxisResizeBounds(plan, beforeIndex, afterIndex);
          expect(bounds).toMatchObject({ minBeforeSize: min, maxBeforeSize: max });
          const target = min + Math.round(((max - min) * targetSelector) / 100);
          const weights = resizeAxis(plan, beforeIndex, afterIndex, target);
          const expected = [...plan.allocation.sizes];
          expected[beforeIndex] = target;
          expected[afterIndex] = beforeSize + afterSize - target;
          expect(replay(items, weights, available).sizes).toEqual(expected);
        },
      ),
      { numRuns: 2000, seed: 8126 },
    );
  });
});
