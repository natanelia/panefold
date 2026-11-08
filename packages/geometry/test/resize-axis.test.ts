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
    [1, 1],
    [1, 7],
    [1e6, 7],
  ])("keeps a capped sibling from making grow factors %s/%s snap", (beforeGrow, afterGrow) => {
    const items = canonicalItems([
      { key: "capped", constraints: { max: 100, grow: 1e6 } },
      { key: "before", constraints: { grow: beforeGrow } },
      { key: "after", constraints: { grow: afterGrow } },
    ]);
    const plan = createAxisResizePlan(items, 1000, 6);
    expect(plan.allocation.sizes[0]).toBe(100);
    for (const target of [150, 300, 301, 450, 600, 750]) {
      const weights = resizeAxis(plan, 1, 2, target);
      expect(normalizeSplitWeights(weights)).toEqual(weights);
      const actual = allocateAxis(
        items.map((item, index) => ({ ...item, weight: weights[index] ?? 1 })),
        1000,
        6,
      );
      expect(actual.sizes).toEqual([100, target, 888 - target]);
    }
  });

  it.each([true, false])(
    "fills canonical bands using lower-bound sibling slack (fast primary: %s)",
    (fastPrimary) => {
      const items = canonicalItems(
        [fastPrimary ? 1e6 : 1, fastPrimary ? 1 : 1e6, 1].map((grow, index) => ({
          key: String(index),
          constraints: { min: 100, grow },
        })),
      );
      const plan = createAxisResizePlan(items, 1000);
      // For fast-pane weights 1,2,3,4 the lower-bound sibling can absorb spare
      // canonical weight, yielding these exact integer bands. The gaps between
      // bands are unavoidable; pixels inside them must not be sampled away.
      const bands = [
        [450, 500],
        [600, 667],
        [675, 800],
      ] as const;
      let previousBefore = -Infinity;
      for (
        let beforeTarget = fastPrimary ? 450 : 100;
        beforeTarget <= (fastPrimary ? 800 : 450);
        beforeTarget += 1
      ) {
        const fastTarget = fastPrimary ? beforeTarget : 900 - beforeTarget;
        let expectedFast = 450;
        for (const [lower, upper] of bands) {
          const candidate = Math.min(upper, Math.max(lower, fastTarget));
          const distance = Math.abs(candidate - fastTarget);
          const priorDistance = Math.abs(expectedFast - fastTarget);
          if (
            distance < priorDistance ||
            (distance === priorDistance &&
              (fastPrimary ? candidate < expectedFast : candidate > expectedFast))
          )
            expectedFast = candidate;
        }
        const weights = resizeAxis(plan, 0, 1, beforeTarget);
        const result = replay(items, weights, 1000);
        const expectedBefore = fastPrimary ? expectedFast : 900 - expectedFast;
        expect(result.sizes).toEqual([expectedBefore, 900 - expectedBefore, 100]);
        expect(expectedBefore).toBeGreaterThanOrEqual(previousBefore);
        previousBefore = expectedBefore;
      }
      const bounds = getAxisResizeBounds(plan, 0, 1);
      for (const target of [bounds.minBeforeSize, bounds.maxBeforeSize]) {
        const weights = resizeAxis(plan, 0, 1, target);
        const next = createAxisResizePlan(
          items.map((item, index) => ({ ...item, weight: weights[index] ?? 1 })),
          1000,
        );
        expect(getAxisResizeBounds(next, 0, 1)).toMatchObject({
          minBeforeSize: bounds.minBeforeSize,
          maxBeforeSize: bounds.maxBeforeSize,
        });
      }
    },
  );

  it.each([
    {
      available: 46,
      before: 1,
      minimum: 17,
      maximum: 23,
      interior: 22,
      items: [
        {
          key: "a",
          weight: 390909,
          constraints: { min: 1.25, max: 35, preferred: 31.25, grow: 0.01, shrink: 0.01 },
        },
        {
          key: "b",
          weight: 277273,
          constraints: { min: 1, max: 23.25, preferred: 13, grow: 10, shrink: 1e-6 },
        },
        {
          key: "c",
          weight: 331818,
          constraints: { min: 9.75, max: 30.5, preferred: 21.75, grow: 1e6, shrink: 1 },
        },
      ],
    },
    {
      available: 28,
      before: 0,
      minimum: 9,
      maximum: 16,
      interior: 11,
      items: [
        {
          key: "a",
          weight: 70064,
          constraints: { min: 0, max: 16.75, preferred: 0, grow: 1e6, shrink: 1e-6 },
        },
        {
          key: "b",
          weight: 369427,
          constraints: { min: 1, max: 34.25, preferred: 29, grow: 1e6, shrink: 1 },
        },
        {
          key: "c",
          weight: 560509,
          constraints: { min: 1.75, max: 29, preferred: 16.75, grow: 0.01, shrink: 0.01 },
        },
      ],
    },
  ])(
    "finds canonical positions when every destination pane is free ($available px)",
    ({ items, available, before, minimum, maximum, interior }) => {
      const after = before + 1;
      const plan = createAxisResizePlan(items, available, 1);
      const bounds = getAxisResizeBounds(plan, before, after);
      expect(bounds).toMatchObject({ minBeforeSize: minimum, maxBeforeSize: maximum });
      for (const target of [minimum, interior, maximum]) {
        const weights = resizeAxis(plan, before, after, target);
        expect(normalizeSplitWeights(weights)).toEqual(weights);
        const updatedItems = items.map((item, index) => ({ ...item, weight: weights[index] ?? 1 }));
        const updatedPlan = createAxisResizePlan(updatedItems, available, 1);
        expect(updatedPlan.allocation.sizes[before]).toBe(target);
        updatedPlan.allocation.sizes.forEach((size, index) => {
          if (index !== before && index !== after) expect(size).toBe(plan.allocation.sizes[index]);
        });
        expect(getAxisResizeBounds(updatedPlan, before, after)).toMatchObject({
          minBeforeSize: minimum,
          maxBeforeSize: maximum,
        });
      }
    },
  );

  it("keeps both limits after resizing a large axis with precise free-pane ratios", () => {
    const scale = 1e6;
    const records = [
      [115702, 70.1, 438.1, 161.1, 0, 2],
      [359504, 12.9, 458.9, 189.9, 0.3, 1e6],
      [355372, 170.1, 406.1, 409.1, 1, 1e6],
      [136364, 40.7, 290.7, 41.7, 0, 2],
      [33058, 158.9, 570.9, 317.9, 2, 2],
    ];
    const items: AllocationItem[] = records.map((record, index) => {
      const [weight = 1, min = 0, max = Infinity, preferred = 0, grow = 1, shrink = 1] = record;
      return {
        key: String(index),
        weight,
        constraints: {
          min: min * scale,
          max: max * scale,
          preferred: preferred * scale,
          grow,
          shrink,
        },
      };
    });
    const plan = createAxisResizePlan(items, 736 * scale, 6 * scale);
    const originalBefore = plan.allocation.sizes[0] ?? 0;
    const bounds = getAxisResizeBounds(plan, 0, 1);
    expect(bounds.maxBeforeSize).toBe(originalBefore);
    for (const target of [bounds.minBeforeSize, bounds.maxBeforeSize]) {
      const weights = resizeAxis(plan, 0, 1, target);
      const nextPlan = createAxisResizePlan(
        items.map((item, index) => ({ ...item, weight: weights[index] ?? 1 })),
        736 * scale,
        6 * scale,
      );
      expect(nextPlan.allocation.sizes[0]).toBe(target);
      expect(nextPlan.allocation.sizes.slice(2)).toEqual(plan.allocation.sizes.slice(2));
      expect(getAxisResizeBounds(nextPlan, 0, 1)).toMatchObject({
        minBeforeSize: bounds.minBeforeSize,
        maxBeforeSize: bounds.maxBeforeSize,
      });
    }
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

  it.each([
    {
      name: "weak minimum-bound children",
      available: 736,
      before: 0,
      after: 1,
      minimum: 71,
      records: [
        [115702, 70.1, 438.1, 161.1, 0, 2],
        [359504, 12.9, 458.9, 189.9, 0.3, 1e6],
        [355372, 170.1, 406.1, 409.1, 1, 1e6],
        [136364, 40.7, 290.7, 41.7, 0, 2],
        [33058, 158.9, 570.9, 317.9, 2, 2],
      ],
    },
    {
      name: "capped fast-growing siblings",
      available: 1559,
      before: 3,
      after: 4,
      minimum: 351,
      records: [
        [254692, 173.2, 440.2, 179.2, 1e6, 0],
        [252011, 67.6, 532.6, 79.6, 0.1, 1],
        [131367, 81.8, 116.8, 291.8, 1, 1],
        [225201, 31.4, 472.4, 71.4, 1e6, 1],
        [136729, 93.8, 548.8, 159.8, 7, 1],
      ],
    },
    {
      name: "fractional room in saturated panes",
      available: 850,
      before: 1,
      after: 2,
      minimum: 307,
      records: [
        [200514, 95, 561, 176, 13, 1e6],
        [239075, 94, 391, 94, 7, 1],
        [205656, 1, 85, 76, 1, 1e6],
        [182519, 168, 575, 454, 1, 5],
        [66838, 131, 285, 152, 13, 1e6, 1],
        [105398, 154, 279, 222, 1, 5],
      ],
    },
  ])(
    "reaches true bounds and moves monotonically with $name",
    ({ records, available, before, after, minimum }) => {
      const items: AllocationItem[] = records.map((record, index) => {
        const [
          weight = 1,
          min = 0,
          max = Infinity,
          preferred = 0,
          grow = 1,
          shrink = 1,
          collapsed = 0,
        ] = record;
        return {
          key: String(index),
          weight,
          collapsed: collapsed === 1,
          constraints: { min, max, preferred, grow, shrink },
        };
      });
      const plan = createAxisResizePlan(items, available, 6);
      const bounds = getAxisResizeBounds(plan, before, after);
      expect(bounds.minBeforeSize).toBe(minimum);
      const positions: number[] = [];
      let previous = minimum;
      for (let target = bounds.minBeforeSize; target <= bounds.maxBeforeSize; target += 1) {
        const weights = resizeAxis(plan, before, after, target);
        const result = allocateAxis(
          items.map((item, index) => ({ ...item, weight: weights[index] ?? 1 })),
          available,
          6,
        );
        const position = result.sizes[before] ?? 0;
        expect(position).toBeGreaterThanOrEqual(previous);
        expect(position).toBeGreaterThanOrEqual(bounds.minBeforeSize);
        expect(position).toBeLessThanOrEqual(bounds.maxBeforeSize);
        result.sizes.forEach((size, index) => {
          if (index !== before && index !== after) expect(size).toBe(plan.allocation.sizes[index]);
        });
        previous = position;
        positions.push(position);
      }
      const reversePlan = createAxisResizePlan(items, available, 6);
      for (let target = bounds.maxBeforeSize; target >= bounds.minBeforeSize; target -= 1) {
        const weights = resizeAxis(reversePlan, before, after, target);
        const result = allocateAxis(
          items.map((item, index) => ({ ...item, weight: weights[index] ?? 1 })),
          available,
          6,
        );
        expect(result.sizes[before]).toBe(positions[target - bounds.minBeforeSize]);
      }
      for (const target of [bounds.minBeforeSize, bounds.maxBeforeSize]) {
        const weights = resizeAxis(plan, before, after, target);
        const nextItems = items.map((item, index) => ({ ...item, weight: weights[index] ?? 1 }));
        const nextPlan = createAxisResizePlan(nextItems, available, 6);
        const nextBounds = getAxisResizeBounds(nextPlan, before, after);
        expect(nextBounds.minBeforeSize).toBe(bounds.minBeforeSize);
        expect(nextBounds.maxBeforeSize).toBe(bounds.maxBeforeSize);
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
    const first = inputs[0];
    if (first === undefined) throw new Error("Expected the first input.");
    first.constraints.min = 450;
    first.weight = 900_000;
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
