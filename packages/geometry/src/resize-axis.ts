import { normalizeSplitWeights } from "@panefold/model";

import { allocateAxis, normalizeItem, type NormalizedItem } from "./allocate-axis.js";
import type { AllocationItem, AxisAllocation, AxisResizeBounds, AxisResizePlan } from "./types.js";

const EPSILON = 1e-9;

interface PreparedPlan {
  readonly plan: AxisResizePlan;
  readonly items: readonly NormalizedItem[];
  readonly active: readonly NormalizedItem[];
  readonly weights: readonly number[];
  readonly canonicalWeights: readonly number[];
  readonly sizes: readonly number[];
  readonly lower: readonly number[];
  readonly upper: readonly number[];
  readonly multipliers: readonly number[];
  readonly fixed: boolean;
  readonly bounds: Map<string, PreparedBounds>;
}

interface ResizeResult {
  readonly weights: readonly number[];
  readonly beforeSize: number;
}

interface PreparedBounds extends AxisResizeBounds {
  readonly minimumWeights: readonly number[];
  readonly maximumWeights: readonly number[];
}

// Plans are immutable values. This cache only avoids repeating their derived
// constraint calculations during a pointer gesture; it owns no layout state.
const preparedPlans = new WeakMap<AxisResizePlan, PreparedPlan>();

/** Capture the same allocator inputs and result used to lay out the split. */
export function createAxisResizePlan(
  items: readonly AllocationItem[],
  availableSize: number,
  splitterSize = 0,
  allocation = allocateAxis(items, availableSize, splitterSize),
): AxisResizePlan {
  const capturedItems = Object.freeze(
    items.map((item) =>
      Object.freeze({
        ...item,
        ...(item.constraints === undefined
          ? {}
          : { constraints: Object.freeze({ ...item.constraints }) }),
      }),
    ),
  );
  const capturedAllocation = Object.freeze({
    ...allocation,
    sizes: Object.freeze([...allocation.sizes]),
    activeIndices: Object.freeze([...allocation.activeIndices]),
    splitterSizes: Object.freeze([...allocation.splitterSizes]),
    collapsedKeys: Object.freeze([...allocation.collapsedKeys]),
    diagnostics: Object.freeze(
      allocation.diagnostics.map((diagnostic) =>
        Object.freeze({
          ...diagnostic,
          ...(diagnostic.itemKeys === undefined
            ? {}
            : { itemKeys: Object.freeze([...diagnostic.itemKeys]) }),
        }),
      ),
    ),
  });
  return Object.freeze({
    items: capturedItems,
    availableSize,
    splitterSize,
    allocation: capturedAllocation,
  });
}

/**
 * Report reachable integer limits without moving unrelated children or
 * changing semantic collapse. Infeasible minima and weight-independent panes
 * have a fixed range. Returned endpoints use the same canonical weights as
 * resizeAxis, including the model's finite weight precision.
 */
export function getAxisResizeBounds(
  plan: AxisResizePlan,
  beforeIndex: number,
  afterIndex: number,
): AxisResizeBounds {
  return prepareBounds(preparePlan(plan), beforeIndex, afterIndex);
}

/**
 * Convert a primary-pane pixel request into canonical split weights. The
 * inverse removes grow/shrink factors across all active children, rather than
 * treating already constrained pixels as new proportions. A forward solve
 * verifies every returned change, so previews and committed geometry agree.
 */
export function resizeAxis(
  plan: AxisResizePlan,
  beforeIndex: number,
  afterIndex: number,
  targetBeforeSize: number,
): readonly number[] {
  const prepared = preparePlan(plan);
  const bounds = prepareBounds(prepared, beforeIndex, afterIndex);
  if (Number.isNaN(targetBeforeSize)) return prepared.weights;
  if (targetBeforeSize <= bounds.minBeforeSize) return bounds.minimumWeights;
  if (targetBeforeSize >= bounds.maxBeforeSize) return bounds.maximumWeights;
  return resolveTarget(prepared, beforeIndex, afterIndex, Math.round(targetBeforeSize)).weights;
}

function preparePlan(plan: AxisResizePlan): PreparedPlan {
  const cached = preparedPlans.get(plan);
  if (cached !== undefined) return cached;
  const items = plan.items.map((item, index) => normalizeItem(item, index, []));
  const activeSet = new Set(plan.allocation.activeIndices);
  const active = items.filter((item) => activeSet.has(item.index));
  const sizes = plan.allocation.sizes;
  const contentSize = sizes.reduce((total, size) => total + size, 0);
  const minViolated =
    active.reduce((total, item) => total + Math.ceil(item.min - EPSILON), 0) > contentSize;
  const maxViolated =
    active.reduce((total, item) => total + Math.floor(item.max + EPSILON), 0) < contentSize;
  const preferencesFit =
    active.reduce((total, item) => total + Math.ceil(item.preferred - EPSILON), 0) <= contentSize;
  const lower = items.map((item) => (preferencesFit ? item.preferred : item.min));
  const upper = items.map((item) => (maxViolated ? Number.POSITIVE_INFINITY : item.max));
  const multipliers = items.map((item) =>
    preferencesFit ? item.grow : 1 / Math.max(item.shrink, EPSILON),
  );
  const weights = Object.freeze(items.map((item) => item.weight));
  const canonicalWeights = Object.freeze(normalizeSplitWeights(weights));
  const result: PreparedPlan = {
    plan,
    items,
    active,
    weights,
    canonicalWeights,
    sizes,
    lower,
    upper,
    multipliers,
    fixed: minViolated || active.length < 2 || contentSize <= 0,
    bounds: new Map(),
  };
  preparedPlans.set(plan, result);
  return result;
}

function prepareBounds(
  prepared: PreparedPlan,
  beforeIndex: number,
  afterIndex: number,
): PreparedBounds {
  const key = `${beforeIndex}:${afterIndex}`;
  const cached = prepared.bounds.get(key);
  if (cached !== undefined) return cached;
  const beforeSize = prepared.sizes[beforeIndex] ?? 0;
  const afterSize = prepared.sizes[afterIndex] ?? 0;
  let minimum: ResizeResult = { weights: prepared.weights, beforeSize };
  let maximum = minimum;
  const activePosition = prepared.plan.allocation.activeIndices.indexOf(beforeIndex);
  if (
    !prepared.fixed &&
    activePosition >= 0 &&
    prepared.plan.allocation.activeIndices[activePosition + 1] === afterIndex &&
    (prepared.multipliers[beforeIndex] ?? 0) > 0 &&
    (prepared.multipliers[afterIndex] ?? 0) > 0
  ) {
    minimum = findEndpoint(prepared, beforeIndex, afterIndex, 0);
    maximum = findEndpoint(prepared, beforeIndex, afterIndex, beforeSize + afterSize);
  }
  const result: PreparedBounds = Object.freeze({
    beforeSize,
    afterSize,
    minBeforeSize: minimum.beforeSize,
    maxBeforeSize: maximum.beforeSize,
    minimumWeights: minimum.weights,
    maximumWeights: maximum.weights,
  });
  prepared.bounds.set(key, result);
  return result;
}

function findEndpoint(
  prepared: PreparedPlan,
  beforeIndex: number,
  afterIndex: number,
  target: number,
): ResizeResult {
  const original = prepared.sizes[beforeIndex] ?? 0;
  const endpoint = resolveTarget(prepared, beforeIndex, afterIndex, target);
  if (endpoint.beforeSize !== original || target === original) return endpoint;

  // A fractional bound or coarse canonical precision can make an extreme
  // request disturb a sibling's rounding. Search back toward the current
  // allocation for a verified endpoint instead of advertising an unsafe bound.
  let near = original;
  let far = target;
  let best = endpoint;
  for (let attempt = 0; attempt < 16 && Math.abs(far - near) > 1; attempt += 1) {
    const middle = Math.round((near + far) / 2);
    const candidate = resolveTarget(prepared, beforeIndex, afterIndex, middle);
    if (candidate.beforeSize !== original) {
      best = candidate;
      near = middle;
    } else {
      far = middle;
    }
  }
  return best;
}

function resolveTarget(
  prepared: PreparedPlan,
  beforeIndex: number,
  afterIndex: number,
  target: number,
): ResizeResult {
  const beforeSize = prepared.sizes[beforeIndex] ?? 0;
  let best: ResizeResult = { weights: prepared.weights, beforeSize };
  if (target === beforeSize) return best;
  const afterSize = prepared.sizes[afterIndex] ?? 0;
  const total = beforeSize + afterSize;
  const beforeLower = Math.max(
    Math.ceil((prepared.items[beforeIndex]?.min ?? 0) - EPSILON),
    Math.floor((prepared.lower[beforeIndex] ?? 0) + EPSILON),
  );
  const afterLower = Math.max(
    Math.ceil((prepared.items[afterIndex]?.min ?? 0) - EPSILON),
    Math.floor((prepared.lower[afterIndex] ?? 0) + EPSILON),
  );
  const minimum = Math.max(
    beforeLower,
    total - Math.floor((prepared.upper[afterIndex] ?? Number.POSITIVE_INFINITY) + EPSILON),
  );
  const maximum = Math.min(
    Math.floor((prepared.upper[beforeIndex] ?? Number.POSITIVE_INFINITY) + EPSILON),
    total - afterLower,
  );
  if (minimum > maximum) return best;
  const desiredBefore = Math.min(maximum, Math.max(minimum, target));
  const wantedSizes = [...prepared.sizes];
  wantedSizes[beforeIndex] = desiredBefore;
  wantedSizes[afterIndex] = total - desiredBefore;
  const saturatedPair = [...wantedSizes];
  saturatedPair[beforeIndex] = Math.min(total, Math.max(0, target));
  saturatedPair[afterIndex] = total - (saturatedPair[beforeIndex] ?? 0);
  const releaseFloorWeights = (seed: readonly number[]) =>
    seed.map((value, index) =>
      value <= Math.ceil((prepared.lower[index] ?? 0) - EPSILON) ? 0 : value,
    );
  const seeds = [
    wantedSizes,
    saturatedPair,
    releaseFloorWeights(wantedSizes),
    releaseFloorWeights(saturatedPair),
  ];
  for (const seed of seeds) {
    const values = [...seed];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const weights = weightsForSizes(prepared, values);
      if (weights === undefined) break;
      const allocation = allocateAxis(
        prepared.plan.items.map((item, index) => ({ ...item, weight: weights[index] ?? 1 })),
        prepared.plan.availableSize,
        prepared.plan.splitterSize,
      );
      const actual = allocation.sizes[beforeIndex] ?? 0;
      const movesTowardTarget =
        target < beforeSize
          ? actual >= target && actual < best.beforeSize
          : actual <= target && actual > best.beforeSize;
      const preservesOthers =
        allocation.activeIndices.length === prepared.plan.allocation.activeIndices.length &&
        allocation.activeIndices.every(
          (index, position) => index === prepared.plan.allocation.activeIndices[position],
        ) &&
        allocation.sizes.every(
          (size, index) =>
            index === beforeIndex || index === afterIndex || size === prepared.sizes[index],
        ) &&
        actual + (allocation.sizes[afterIndex] ?? 0) ===
          beforeSize + (prepared.sizes[afterIndex] ?? 0);
      if (movesTowardTarget && preservesOthers) {
        best = { weights, beforeSize: actual };
        if (actual === desiredBefore) return best;
      }
      // Canonical weight rounding may cross a pixel's tie boundary. Correct the
      // inverse factors; the forward allocator remains authoritative for every
      // declared constraint. Never commit an unverified approximation.
      let changed = false;
      const correction = attempt < 4 ? 0.5 : 0.25;
      for (const item of prepared.active) {
        const index = item.index;
        if ((prepared.multipliers[index] ?? 0) <= 0) continue;
        const error = (wantedSizes[index] ?? 0) - (allocation.sizes[index] ?? 0);
        if (error === 0) continue;
        const prior = values[index] ?? 0;
        const next = Math.max(0, prior + error * correction);
        changed ||= next !== prior;
        values[index] = next;
      }
      if (!changed) break;
    }
  }
  return best;
}

function weightsForSizes(
  prepared: PreparedPlan,
  values: readonly number[],
): readonly number[] | undefined {
  const changing = prepared.active.filter((item) => (prepared.multipliers[item.index] ?? 0) > 0);
  const budget = changing.reduce(
    (total, item) => total + (prepared.canonicalWeights[item.index] ?? 0),
    0,
  );
  if (changing.length === 0 || !Number.isSafeInteger(budget) || budget < changing.length)
    return undefined;
  // Ratios are evaluated in log space so finite extreme grow/shrink inputs do
  // not overflow before canonical normalization. A zero-pixel child still
  // receives a positive semantic weight, as required by the model.
  const logs = changing.map(
    (item) =>
      Math.log(Math.max(Number.MIN_VALUE, values[item.index] ?? 0)) -
      Math.log(prepared.multipliers[item.index] ?? 1),
  );
  const largest = Math.max(...logs);
  if (!Number.isFinite(largest)) return undefined;
  const raw = logs.map((value) => Math.max(Number.MIN_VALUE, Math.exp(value - largest)));
  const normalized = normalizeSplitWeights(raw, budget);
  const weights = [...prepared.canonicalWeights];
  changing.forEach((item, index) => {
    weights[item.index] = normalized[index] ?? 1;
  });
  return Object.freeze(weights);
}
