import { normalizeSplitWeights } from "@panefold/model";

import { allocateAxis, normalizeItem, type NormalizedItem } from "./allocate-axis.js";
import type { AllocationItem, AxisResizeBounds, AxisResizePlan } from "./types.js";

const EPSILON = 1e-9;
const LOCAL_PIXEL_SEARCH = 32;
const CRITICAL_STATE_SOLVE_LIMIT = 2048;

interface PreparedPlan {
  readonly plan: AxisResizePlan;
  readonly items: readonly NormalizedItem[];
  readonly active: readonly NormalizedItem[];
  readonly weights: readonly number[];
  readonly canonicalWeights: readonly number[];
  readonly changing: readonly NormalizedItem[];
  readonly weightBudget: number;
  readonly sizes: readonly number[];
  readonly lower: readonly number[];
  readonly upper: readonly number[];
  readonly multipliers: readonly number[];
  readonly fixed: boolean;
  readonly bounds: Map<string, PreparedBounds>;
  readonly targets: Map<string, ResizeResult>;
  readonly slackPairs: Map<string, SlackPair | undefined>;
}

interface ResizeResult {
  readonly weights: readonly number[];
  readonly beforeSize: number;
}

interface PreparedBounds extends AxisResizeBounds {
  readonly minimumWeights: readonly number[];
  readonly maximumWeights: readonly number[];
  readonly states?: readonly ResizeResult[];
  readonly slack?: boolean;
}

interface SlackResult extends ResizeResult {
  readonly pivotSize: number;
  readonly valid: boolean;
}

interface SlackPair {
  readonly beforeIndex: number;
  readonly afterIndex: number;
  readonly pivotIndex: number;
  readonly remainingIndex: number;
  readonly absorberIndex: number;
  minimumPivotWeight: number;
  readonly maximumPivotWeight: number;
  readonly results: Map<string, SlackResult>;
  readonly bandStarts: Map<number, number>;
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
  if (Number.isNaN(targetBeforeSize) || Math.round(targetBeforeSize) === bounds.beforeSize)
    return prepared.weights;
  if (targetBeforeSize <= bounds.minBeforeSize) return bounds.minimumWeights;
  if (targetBeforeSize >= bounds.maxBeforeSize) return bounds.maximumWeights;
  const target = Math.round(targetBeforeSize);
  if (target <= bounds.minBeforeSize) return bounds.minimumWeights;
  if (target >= bounds.maxBeforeSize) return bounds.maximumWeights;
  if (prepared.active.length === 2) {
    return resizeCanonicalPair(prepared, beforeIndex, afterIndex, target).weights;
  }
  if (bounds.slack) {
    const pair = prepared.slackPairs.get(`${beforeIndex}:${afterIndex}`);
    if (pair !== undefined) return resizeSlackPair(prepared, pair, target).weights;
  }
  if (bounds.states !== undefined) return nearestState(bounds.states, target).weights;
  const direct = resolveTarget(prepared, beforeIndex, afterIndex, target);
  if (direct.beforeSize === target) return direct.weights;
  // Canonical weight precision can leave gaps between reachable pixels. Pick
  // the nearest verified pixel with a stable lower-value tie-break, rather
  // than jumping back to the gesture's origin when one exact inverse fails.
  for (let distance = 1; distance <= LOCAL_PIXEL_SEARCH; distance += 1) {
    const lower = target - distance;
    if (lower === bounds.minBeforeSize) return bounds.minimumWeights;
    if (lower > bounds.minBeforeSize) {
      const candidate = resolveTarget(prepared, beforeIndex, afterIndex, lower);
      if (candidate.beforeSize === lower) return candidate.weights;
    }
    const upper = target + distance;
    if (upper === bounds.maxBeforeSize) return bounds.maximumWeights;
    if (upper < bounds.maxBeforeSize) {
      const candidate = resolveTarget(prepared, beforeIndex, afterIndex, upper);
      if (candidate.beforeSize === upper) return candidate.weights;
    }
  }
  return direct.weights;
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
  const changing = active.filter((item) => (multipliers[item.index] ?? 0) > 0);
  const weightBudget = changing.reduce(
    (total, item) => total + (canonicalWeights[item.index] ?? 0),
    0,
  );
  const result: PreparedPlan = {
    plan,
    items,
    active,
    weights,
    canonicalWeights,
    changing,
    weightBudget,
    sizes,
    lower,
    upper,
    multipliers,
    fixed:
      minViolated || active.length < 2 || contentSize <= 0 || !Number.isSafeInteger(contentSize),
    bounds: new Map(),
    targets: new Map(),
    slackPairs: new Map(),
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
  let states: readonly ResizeResult[] | undefined;
  let slack = false;
  const activePosition = prepared.plan.allocation.activeIndices.indexOf(beforeIndex);
  if (
    !prepared.fixed &&
    activePosition >= 0 &&
    prepared.plan.allocation.activeIndices[activePosition + 1] === afterIndex &&
    (prepared.multipliers[beforeIndex] ?? 0) > 0 &&
    (prepared.multipliers[afterIndex] ?? 0) > 0
  ) {
    if (prepared.active.length === 2) {
      minimum = canonicalPairResult(prepared, beforeIndex, afterIndex, 1);
      maximum = canonicalPairResult(prepared, beforeIndex, afterIndex, prepared.weightBudget - 1);
    } else if (precisionLimited(prepared, beforeIndex, afterIndex)) {
      const pair = prepareSlackPair(prepared, beforeIndex, afterIndex);
      if (pair !== undefined) {
        slack = true;
        const low = slackResult(
          prepared,
          pair,
          pair.minimumPivotWeight,
          prepared.weightBudget - pair.minimumPivotWeight - 1,
        );
        const high = slackResult(prepared, pair, pair.maximumPivotWeight, 1);
        minimum = pair.pivotIndex === beforeIndex ? low : high;
        maximum = pair.pivotIndex === beforeIndex ? high : low;
      } else {
        minimum = resolveTarget(prepared, beforeIndex, afterIndex, 0);
        maximum = resolveTarget(prepared, beforeIndex, afterIndex, beforeSize + afterSize);
        states = criticalStates(prepared, beforeIndex, afterIndex, minimum, maximum);
        minimum = states[0] ?? minimum;
        maximum = states[states.length - 1] ?? maximum;
      }
    } else {
      minimum = findEndpoint(prepared, beforeIndex, afterIndex, 0);
      maximum = findEndpoint(prepared, beforeIndex, afterIndex, beforeSize + afterSize);
    }
  }
  // The starting geometry is itself reachable, even if finite-precision
  // inversion could not reconstruct a more distant requested endpoint.
  if (minimum.beforeSize > beforeSize) minimum = { weights: prepared.weights, beforeSize };
  if (maximum.beforeSize < beforeSize) maximum = { weights: prepared.weights, beforeSize };
  const result: PreparedBounds = Object.freeze({
    beforeSize,
    afterSize,
    minBeforeSize: minimum.beforeSize,
    maxBeforeSize: maximum.beforeSize,
    minimumWeights: minimum.weights,
    maximumWeights: maximum.weights,
    ...(states === undefined ? {} : { states }),
    ...(slack ? { slack: true } : {}),
  });
  prepared.bounds.set(key, result);
  return result;
}

function canonicalPairResult(
  prepared: PreparedPlan,
  beforeIndex: number,
  afterIndex: number,
  beforeWeight: number,
): ResizeResult {
  const key = `weight:${beforeIndex}:${afterIndex}:${beforeWeight}`;
  const cached = prepared.targets.get(key);
  if (cached !== undefined) return cached;
  const weights = [...prepared.canonicalWeights];
  weights[beforeIndex] = beforeWeight;
  weights[afterIndex] = prepared.weightBudget - beforeWeight;
  const allocation = allocateAxis(
    prepared.plan.items.map((item, index) => ({ ...item, weight: weights[index] ?? 1 })),
    prepared.plan.availableSize,
    prepared.plan.splitterSize,
  );
  const result = {
    weights: Object.freeze(weights),
    beforeSize: allocation.sizes[beforeIndex] ?? 0,
  };
  prepared.targets.set(key, result);
  return result;
}

/** Two active panes have a monotone, finite canonical weight domain. */
function resizeCanonicalPair(
  prepared: PreparedPlan,
  beforeIndex: number,
  afterIndex: number,
  target: number,
): ResizeResult {
  if (target === prepared.sizes[beforeIndex])
    return { weights: prepared.weights, beforeSize: target };
  let lower = 1;
  let upper = prepared.weightBudget - 1;
  let closest = canonicalPairResult(prepared, beforeIndex, afterIndex, lower);
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const candidate = canonicalPairResult(prepared, beforeIndex, afterIndex, middle);
    const distance = Math.abs(candidate.beforeSize - target);
    const closestDistance = Math.abs(closest.beforeSize - target);
    if (
      distance < closestDistance ||
      (distance === closestDistance && candidate.beforeSize < closest.beforeSize)
    ) {
      closest = candidate;
    }
    if (candidate.beforeSize === target) return candidate;
    if (candidate.beforeSize < target) lower = middle + 1;
    else upper = middle - 1;
  }
  return closest;
}

/**
 * Three panes with one integer lower-bound sibling have a useful exact path
 * when that sibling and the slower changing pane share a multiplier. Fixing
 * the faster pane's weight creates an interval of valid remaining weights.
 * Those intervals, and their pixel endpoints, are monotone in the fixed
 * weight. With content <= canonical budget, every pixel inside an interval is
 * attainable. Search these bands instead of sampling their interiors.
 */
function prepareSlackPair(
  prepared: PreparedPlan,
  beforeIndex: number,
  afterIndex: number,
): SlackPair | undefined {
  const key = `${beforeIndex}:${afterIndex}`;
  if (prepared.slackPairs.has(key)) return prepared.slackPairs.get(key);
  prepared.slackPairs.set(key, undefined);
  if (prepared.active.length !== 3 || prepared.changing.length !== 3) return undefined;
  const absorber = prepared.active.find(
    (item) => item.index !== beforeIndex && item.index !== afterIndex,
  );
  if (absorber === undefined) return undefined;
  const pivotIndex =
    (prepared.multipliers[beforeIndex] ?? 1) >= (prepared.multipliers[afterIndex] ?? 1)
      ? beforeIndex
      : afterIndex;
  const remainingIndex = pivotIndex === beforeIndex ? afterIndex : beforeIndex;
  const lower = prepared.lower[absorber.index] ?? 0;
  const slowerFactor = prepared.multipliers[remainingIndex] ?? 0;
  if (
    !Number.isInteger(lower) ||
    lower <= 0 ||
    prepared.sizes[absorber.index] !== lower ||
    slowerFactor <= EPSILON ||
    prepared.multipliers[absorber.index] !== slowerFactor ||
    prepared.sizes.reduce((sum, size) => sum + size, 0) > prepared.weightBudget
  )
    return undefined;
  const pair: SlackPair = {
    beforeIndex,
    afterIndex,
    pivotIndex,
    remainingIndex,
    absorberIndex: absorber.index,
    minimumPivotWeight: 1,
    maximumPivotWeight: prepared.weightBudget - 2,
    results: new Map(),
    bandStarts: new Map(),
  };
  if (!slackResult(prepared, pair, pair.maximumPivotWeight, 1).valid) return undefined;
  let lowerWeight = 1;
  let upperWeight = pair.maximumPivotWeight;
  while (lowerWeight < upperWeight) {
    const middle = Math.floor((lowerWeight + upperWeight) / 2);
    if (slackResult(prepared, pair, middle, prepared.weightBudget - middle - 1).valid)
      upperWeight = middle;
    else lowerWeight = middle + 1;
  }
  pair.minimumPivotWeight = lowerWeight;
  prepared.slackPairs.set(key, pair);
  return pair;
}

function slackResult(
  prepared: PreparedPlan,
  pair: SlackPair,
  pivotWeight: number,
  remainingWeight: number,
): SlackResult {
  const key = `${pivotWeight}:${remainingWeight}`;
  const cached = pair.results.get(key);
  if (cached !== undefined) return cached;
  const weights = [...prepared.canonicalWeights];
  weights[pair.pivotIndex] = pivotWeight;
  weights[pair.remainingIndex] = remainingWeight;
  weights[pair.absorberIndex] = prepared.weightBudget - pivotWeight - remainingWeight;
  const allocation = allocateAxis(
    prepared.plan.items.map((item, index) => ({ ...item, weight: weights[index] ?? 1 })),
    prepared.plan.availableSize,
    prepared.plan.splitterSize,
  );
  const result = Object.freeze({
    weights: Object.freeze(weights),
    beforeSize: allocation.sizes[pair.beforeIndex] ?? 0,
    pivotSize: allocation.sizes[pair.pivotIndex] ?? 0,
    valid: allocation.sizes.every(
      (size, index) =>
        index === pair.beforeIndex || index === pair.afterIndex || size === prepared.sizes[index],
    ),
  });
  pair.results.set(key, result);
  return result;
}

function slackBandStart(prepared: PreparedPlan, pair: SlackPair, pivotWeight: number): number {
  const cached = pair.bandStarts.get(pivotWeight);
  if (cached !== undefined) return cached;
  let lower = 1;
  let upper = prepared.weightBudget - pivotWeight - 1;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (slackResult(prepared, pair, pivotWeight, middle).valid) upper = middle;
    else lower = middle + 1;
  }
  pair.bandStarts.set(pivotWeight, lower);
  return lower;
}

function resizeSlackPair(prepared: PreparedPlan, pair: SlackPair, target: number): ResizeResult {
  const total = (prepared.sizes[pair.beforeIndex] ?? 0) + (prepared.sizes[pair.afterIndex] ?? 0);
  const pivotTarget = pair.pivotIndex === pair.beforeIndex ? target : total - target;
  let lower = pair.minimumPivotWeight;
  let upper = pair.maximumPivotWeight;
  let pivotWeight = lower;
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const candidate = slackResult(prepared, pair, middle, prepared.weightBudget - middle - 1);
    if (candidate.pivotSize <= pivotTarget) {
      pivotWeight = middle;
      lower = middle + 1;
    } else upper = middle - 1;
  }
  lower = slackBandStart(prepared, pair, pivotWeight);
  upper = prepared.weightBudget - pivotWeight - 1;
  let closest = slackResult(prepared, pair, pivotWeight, lower);
  const bandMaximum = closest.pivotSize;
  const consider = (candidate: SlackResult) => {
    const distance = Math.abs(candidate.beforeSize - target);
    const priorDistance = Math.abs(closest.beforeSize - target);
    if (
      candidate.valid &&
      (distance < priorDistance ||
        (distance === priorDistance && candidate.beforeSize < closest.beforeSize))
    )
      closest = candidate;
  };
  // A target in a genuine canonical gap lies between this band's maximum and
  // the next band's minimum. Both endpoints are actual verified allocations.
  if (pivotWeight < pair.maximumPivotWeight)
    consider(slackResult(prepared, pair, pivotWeight + 1, prepared.weightBudget - pivotWeight - 2));
  if (pivotTarget >= bandMaximum) return closest;
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const candidate = slackResult(prepared, pair, pivotWeight, middle);
    consider(candidate);
    if (candidate.beforeSize === target) return candidate;
    if (candidate.pivotSize > pivotTarget) lower = middle + 1;
    else upper = middle - 1;
  }
  return closest;
}

function findEndpoint(
  prepared: PreparedPlan,
  beforeIndex: number,
  afterIndex: number,
  target: number,
): ResizeResult {
  const original = prepared.sizes[beforeIndex] ?? 0;
  const endpoint = resolveTarget(prepared, beforeIndex, afterIndex, target);
  const limits = pixelLimits(prepared, beforeIndex, afterIndex);
  if (limits.minimum > limits.maximum) return endpoint;
  // Feasibility is not monotone in requested weights after canonical rounding.
  // Search integer positions from the actual constraint boundary, independent
  // of the gesture's starting position. Every successful result is verified.
  if (target < original) {
    for (let offset = 1; offset <= LOCAL_PIXEL_SEARCH; offset += 1) {
      const size = limits.minimum + offset;
      if (size >= endpoint.beforeSize) break;
      const candidate = resolveTarget(prepared, beforeIndex, afterIndex, size);
      if (candidate.beforeSize === size) return candidate;
    }
  } else if (target > original) {
    for (let offset = 1; offset <= LOCAL_PIXEL_SEARCH; offset += 1) {
      const size = limits.maximum - offset;
      if (size <= endpoint.beforeSize) break;
      const candidate = resolveTarget(prepared, beforeIndex, afterIndex, size);
      if (candidate.beforeSize === size) return candidate;
    }
  }
  return endpoint;
}

function pixelLimits(prepared: PreparedPlan, beforeIndex: number, afterIndex: number) {
  const total = (prepared.sizes[beforeIndex] ?? 0) + (prepared.sizes[afterIndex] ?? 0);
  const beforeLower = Math.max(
    Math.ceil((prepared.items[beforeIndex]?.min ?? 0) - EPSILON),
    Math.floor((prepared.lower[beforeIndex] ?? 0) + EPSILON),
  );
  const afterLower = Math.max(
    Math.ceil((prepared.items[afterIndex]?.min ?? 0) - EPSILON),
    Math.floor((prepared.lower[afterIndex] ?? 0) + EPSILON),
  );
  return {
    minimum: Math.max(
      beforeLower,
      total - Math.floor((prepared.upper[afterIndex] ?? Number.POSITIVE_INFINITY) + EPSILON),
    ),
    maximum: Math.min(
      Math.floor((prepared.upper[beforeIndex] ?? Number.POSITIVE_INFINITY) + EPSILON),
      total - afterLower,
    ),
  };
}

function resolveTarget(
  prepared: PreparedPlan,
  beforeIndex: number,
  afterIndex: number,
  target: number,
): ResizeResult {
  const key = `${beforeIndex}:${afterIndex}:${target}`;
  const cached = prepared.targets.get(key);
  if (cached !== undefined) return cached;
  const result = solveTarget(prepared, beforeIndex, afterIndex, target);
  prepared.targets.set(key, result);
  return result;
}

function solveTarget(
  prepared: PreparedPlan,
  beforeIndex: number,
  afterIndex: number,
  target: number,
): ResizeResult {
  const beforeSize = prepared.sizes[beforeIndex] ?? 0;
  let best: ResizeResult = { weights: prepared.weights, beforeSize };
  let found = false;
  const afterSize = prepared.sizes[afterIndex] ?? 0;
  const total = beforeSize + afterSize;
  const { minimum, maximum } = pixelLimits(prepared, beforeIndex, afterIndex);
  if (minimum > maximum) return best;
  const desiredBefore = Math.min(maximum, Math.max(minimum, target));
  const wantedSizes = [...prepared.sizes];
  wantedSizes[beforeIndex] = desiredBefore;
  wantedSizes[afterIndex] = total - desiredBefore;
  for (let seedIndex = 0; seedIndex < 4; seedIndex += 1) {
    const values = [...wantedSizes];
    if (seedIndex % 2 === 1) {
      values[beforeIndex] = Math.min(total, Math.max(0, target));
      values[afterIndex] = total - (values[beforeIndex] ?? 0);
    }
    if (seedIndex >= 2) {
      for (const item of prepared.changing) {
        if ((values[item.index] ?? 0) <= Math.ceil((prepared.lower[item.index] ?? 0) - EPSILON)) {
          values[item.index] = 0;
        }
      }
    }
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
        !found ||
        Math.abs(actual - target) < Math.abs(best.beforeSize - target) ||
        (Math.abs(actual - target) === Math.abs(best.beforeSize - target) &&
          actual < best.beforeSize);
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
        found = true;
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
  for (const weights of weightsWithBoundSlack(prepared, wantedSizes)) {
    const allocation = allocateAxis(
      prepared.plan.items.map((item, index) => ({ ...item, weight: weights[index] ?? 1 })),
      prepared.plan.availableSize,
      prepared.plan.splitterSize,
    );
    const actual = allocation.sizes[beforeIndex] ?? 0;
    const movesTowardTarget =
      !found ||
      Math.abs(actual - target) < Math.abs(best.beforeSize - target) ||
      (Math.abs(actual - target) === Math.abs(best.beforeSize - target) &&
        actual < best.beforeSize);
    const preservesOthers =
      allocation.activeIndices.length === prepared.plan.allocation.activeIndices.length &&
      allocation.activeIndices.every(
        (index, position) => index === prepared.plan.allocation.activeIndices[position],
      ) &&
      allocation.sizes.every(
        (size, index) =>
          index === beforeIndex || index === afterIndex || size === prepared.sizes[index],
      ) &&
      actual + (allocation.sizes[afterIndex] ?? 0) === beforeSize + afterSize;
    if (movesTowardTarget && preservesOthers) {
      best = { weights, beforeSize: actual };
      found = true;
      if (actual === desiredBefore) return best;
    }
  }
  return best;
}

function weightsForSizes(
  prepared: PreparedPlan,
  values: readonly number[],
): readonly number[] | undefined {
  const changing = prepared.changing;
  const budget = prepared.weightBudget;
  if (changing.length === 0 || !Number.isSafeInteger(budget) || budget < changing.length)
    return undefined;
  // Ordinary UI dimensions do not need logarithms. Reserve the log-space
  // path for finite extreme factors whose direct inverse overflows.
  let raw = changing.map((item) =>
    Math.max(Number.MIN_VALUE, (values[item.index] ?? 0) / (prepared.multipliers[item.index] ?? 1)),
  );
  const total = raw.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    const logs = changing.map(
      (item) =>
        Math.log(Math.max(Number.MIN_VALUE, values[item.index] ?? 0)) -
        Math.log(prepared.multipliers[item.index] ?? 1),
    );
    const largest = Math.max(...logs);
    if (!Number.isFinite(largest)) return undefined;
    raw = logs.map((value) => Math.max(Number.MIN_VALUE, Math.exp(value - largest)));
  }
  const normalized = normalizeSplitWeights(raw, budget);
  const weights = [...prepared.canonicalWeights];
  changing.forEach((item, index) => {
    weights[item.index] = normalized[index] ?? 1;
  });
  return Object.freeze(weights);
}

/**
 * A child held at a lower bound can absorb a range of weights without moving;
 * an upper-bound child can absorb every weight above its saturation threshold.
 * Use that slack when ordinary inverse normalization leaves a fast-growing or
 * slowly-shrinking child with only a handful of canonical weight units.
 */
function* weightsWithBoundSlack(
  prepared: PreparedPlan,
  values: readonly number[],
  suppliedScales?: readonly number[],
  margins: readonly number[] = [0, 0.25, 0.5, 0.75],
): Iterable<readonly number[]> {
  const changing = prepared.changing;
  const budget = prepared.weightBudget;
  if (!Number.isSafeInteger(budget) || budget < changing.length) return;
  const entries = changing.map((item) => {
    const index = item.index;
    const multiplier = prepared.multipliers[index] ?? 1;
    const size = values[index] ?? 0;
    const lower = prepared.lower[index] ?? 0;
    const upper = prepared.upper[index] ?? Number.POSITIVE_INFINITY;
    const atLower = size <= Math.ceil(lower - EPSILON);
    const atUpper = Number.isFinite(upper) && size >= Math.floor(upper + EPSILON);
    return {
      index,
      kind: atLower && atUpper ? "fixed" : atLower ? "lower" : atUpper ? "upper" : "free",
      coefficient: size / multiplier,
      lowerCoefficient: lower / multiplier,
      upperCoefficient: upper / multiplier,
      multiplier,
      size,
    } as const;
  });
  if (!entries.some((entry) => entry.kind !== "free")) {
    if (suppliedScales !== undefined) {
      const weights = weightsForSizes(prepared, values);
      if (weights !== undefined) yield weights;
    }
    return;
  }
  const reserved = entries.filter(
    (entry) => entry.kind === "lower" || entry.kind === "fixed",
  ).length;
  const basis = entries.reduce(
    (total, entry) =>
      total +
      (entry.kind === "free"
        ? entry.coefficient
        : entry.kind === "upper"
          ? entry.upperCoefficient
          : 0),
    0,
  );
  if (!Number.isFinite(basis) || basis <= 0 || budget <= reserved) return;
  const maximumScale = (budget - reserved) / basis;
  if (!Number.isFinite(maximumScale) || maximumScale <= 0) return;
  const anchors = entries
    .filter(
      (entry) =>
        entry.kind === "free" && entry.coefficient > 0 && Number.isFinite(entry.coefficient),
    )
    .sort((left, right) => left.coefficient - right.coefficient)
    .slice(0, 3);
  const scales = new Set(suppliedScales ?? [maximumScale]);
  for (const anchor of suppliedScales === undefined ? anchors : []) {
    const top = Math.min(budget, Math.max(1, Math.ceil(maximumScale * anchor.coefficient)));
    if (top > 128) continue;
    const bottom = Math.max(1, top - 63);
    for (let weight = top; weight >= bottom; weight -= 1) {
      scales.add(weight / anchor.coefficient);
    }
  }
  for (const scale of scales) {
    for (const margin of margins) {
      const weights = [...prepared.canonicalWeights];
      const absorbers: { index: number; capacity: number; bounded: boolean }[] = [];
      let used = 0;
      for (const entry of entries) {
        let weight = 1;
        if (entry.kind === "free") weight = Math.max(1, Math.round(scale * entry.coefficient));
        if (entry.kind === "upper") {
          const threshold = Math.min(
            entry.upperCoefficient,
            Math.max(0, entry.size - margin) / entry.multiplier,
          );
          weight = Math.max(1, Math.ceil(scale * threshold));
        }
        if (!Number.isSafeInteger(weight)) {
          used = budget + 1;
          break;
        }
        weights[entry.index] = weight;
        used += weight;
        if (entry.kind === "lower") {
          const threshold = Math.max(
            entry.lowerCoefficient,
            (entry.size + margin) / entry.multiplier,
          );
          absorbers.push({
            index: entry.index,
            capacity: Math.max(0, Math.floor(scale * threshold) - weight),
            bounded: true,
          });
        } else if (entry.kind === "upper" || entry.kind === "fixed") {
          absorbers.push({
            index: entry.index,
            capacity: Number.POSITIVE_INFINITY,
            bounded: false,
          });
        }
      }
      if (used > budget) continue;
      // Try lower-bound slack first: filling an already capped upper child can
      // otherwise discard the fractional room needed by another rounded pane.
      for (const lowerFirst of [true, false]) {
        const candidate = [...weights];
        let remaining = budget - used;
        absorbers.sort(
          (left, right) =>
            (lowerFirst ? Number(right.bounded) - Number(left.bounded) : 0) ||
            right.capacity - left.capacity ||
            left.index - right.index,
        );
        for (const absorber of absorbers) {
          const extra = Math.min(remaining, absorber.capacity);
          candidate[absorber.index] = (candidate[absorber.index] ?? 1) + extra;
          remaining -= extra;
          if (remaining === 0) break;
        }
        if (remaining === 0) yield Object.freeze(candidate);
      }
    }
  }
}

function precisionLimited(prepared: PreparedPlan, beforeIndex: number, afterIndex: number) {
  const content = prepared.sizes.reduce((sum, size) => sum + size, 0);
  const freeOthers = prepared.changing.filter(
    (item) =>
      item.index !== beforeIndex &&
      item.index !== afterIndex &&
      (prepared.sizes[item.index] ?? 0) > Math.ceil((prepared.lower[item.index] ?? 0) - EPSILON) &&
      (prepared.sizes[item.index] ?? 0) <
        Math.floor((prepared.upper[item.index] ?? Infinity) + EPSILON),
  );
  const upperAbsorber = prepared.changing.some(
    (item) =>
      item.index !== beforeIndex &&
      item.index !== afterIndex &&
      (prepared.sizes[item.index] ?? 0) >=
        Math.floor((prepared.upper[item.index] ?? Infinity) + EPSILON),
  );
  // A capped sibling can absorb unused canonical weight. Its large growth
  // factor does not by itself make the changing pair's pixel range coarse.
  if (freeOthers.length === 0 && upperAbsorber && content <= prepared.weightBudget) return false;
  const factors = [
    prepared.multipliers[beforeIndex] ?? 1,
    prepared.multipliers[afterIndex] ?? 1,
    ...freeOthers.map((item) => prepared.multipliers[item.index] ?? 1),
  ];
  return (content / prepared.weightBudget) * (Math.max(...factors) / Math.min(...factors)) >= 1;
}

function nearestState(states: readonly ResizeResult[], target: number): ResizeResult {
  let lower = 0;
  let upper = states.length - 1;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if ((states[middle]?.beforeSize ?? Infinity) < target) lower = middle + 1;
    else upper = middle;
  }
  const high = states[lower];
  const low = states[Math.max(0, lower - 1)];
  if (high === undefined || low === undefined)
    throw new RangeError("A resize path needs a verified state.");
  return target - low.beforeSize <= high.beforeSize - target ? low : high;
}

function criticalUnits(minimum: number, maximum: number): readonly number[] {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum < minimum) return [];
  const lower = Math.max(1, Math.ceil(minimum));
  const upper = Math.max(lower, Math.floor(maximum));
  const units = new Set<number>();
  for (let offset = 0; offset < 32 && lower + offset <= upper; offset += 1)
    units.add(lower + offset);
  for (let offset = 0; offset < 8 && upper - offset >= lower; offset += 1)
    units.add(upper - offset);
  for (let value = 1; value <= upper; value *= 2) if (value >= lower) units.add(value);
  return [...units].sort((left, right) => left - right);
}

/** Integer weight ratios close to a requested pixel ratio, in O(log budget). */
function ratioDenominators(ratio: number, budget: number): readonly number[] {
  if (!Number.isFinite(ratio) || ratio <= 0) return [];
  const denominators: number[] = [];
  let priorNumerator = 0;
  let numerator = 1;
  let priorDenominator = 1;
  let denominator = 0;
  let remainder = ratio;
  // With numerator and denominator bounded by the million-unit canonical
  // budget, continued fractions terminate well before this numerical guard.
  for (let step = 0; step < 64; step += 1) {
    const whole = Math.floor(remainder);
    const nextNumerator = whole * numerator + priorNumerator;
    const nextDenominator = whole * denominator + priorDenominator;
    if (nextNumerator > budget || nextDenominator > budget) break;
    if (nextNumerator > 0 && nextDenominator > 0) denominators.push(nextDenominator);
    const fraction = remainder - whole;
    if (fraction <= Number.EPSILON) break;
    priorNumerator = numerator;
    numerator = nextNumerator;
    priorDenominator = denominator;
    denominator = nextDenominator;
    remainder = 1 / fraction;
  }
  return denominators;
}

/** A bounded path through actual canonical weight transitions, never pixel bins. */
function criticalStates(
  prepared: PreparedPlan,
  beforeIndex: number,
  afterIndex: number,
  minimum: ResizeResult,
  maximum: ResizeResult,
): readonly ResizeResult[] {
  const states = new Map<number, ResizeResult>([
    [minimum.beforeSize, minimum],
    [maximum.beforeSize, maximum],
    [
      prepared.sizes[beforeIndex] ?? 0,
      { weights: prepared.weights, beforeSize: prepared.sizes[beforeIndex] ?? 0 },
    ],
  ]);
  const pair = (prepared.sizes[beforeIndex] ?? 0) + (prepared.sizes[afterIndex] ?? 0);
  const limits = pixelLimits(prepared, beforeIndex, afterIndex);
  let solves = 0;
  const attemptedWeights = new Set<string>();
  const add = (weights: readonly number[]) => {
    if (solves >= CRITICAL_STATE_SOLVE_LIMIT) return;
    const key = weights.join(",");
    if (attemptedWeights.has(key)) return;
    attemptedWeights.add(key);
    solves += 1;
    const allocation = allocateAxis(
      prepared.plan.items.map((item, index) => ({ ...item, weight: weights[index] ?? 1 })),
      prepared.plan.availableSize,
      prepared.plan.splitterSize,
    );
    if (
      allocation.activeIndices.length === prepared.plan.allocation.activeIndices.length &&
      allocation.activeIndices.every(
        (index, position) => index === prepared.plan.allocation.activeIndices[position],
      ) &&
      allocation.sizes.every(
        (size, index) =>
          index === beforeIndex || index === afterIndex || size === prepared.sizes[index],
      ) &&
      (allocation.sizes[beforeIndex] ?? 0) + (allocation.sizes[afterIndex] ?? 0) === pair
    ) {
      const position = allocation.sizes[beforeIndex] ?? 0;
      if (!states.has(position))
        states.set(position, { weights: Object.freeze([...weights]), beforeSize: position });
    }
  };
  const beforeFactor = prepared.multipliers[beforeIndex] ?? 1;
  const others = prepared.changing.filter(
    (item) => item.index !== beforeIndex && item.index !== afterIndex,
  );
  const anchors = prepared.changing
    .filter(
      (item) =>
        item.index !== beforeIndex &&
        item.index !== afterIndex &&
        (prepared.sizes[item.index] ?? 0) >
          Math.ceil((prepared.lower[item.index] ?? 0) - EPSILON) &&
        (prepared.sizes[item.index] ?? 0) <
          Math.floor((prepared.upper[item.index] ?? Infinity) + EPSILON),
    )
    .sort(
      (left, right) =>
        (prepared.sizes[left.index] ?? 0) / (prepared.multipliers[left.index] ?? 1) -
        (prepared.sizes[right.index] ?? 0) / (prepared.multipliers[right.index] ?? 1),
    )
    .slice(0, 2);

  // When every unchanged pane is free, no bound can absorb leftover weight.
  // Fix one pair member to a small integer weight and solve the full budget
  // equation for its scale instead of incorrectly requiring bound slack.
  if (
    others.every(
      (item) =>
        (prepared.sizes[item.index] ?? 0) >
          Math.ceil((prepared.lower[item.index] ?? 0) - EPSILON) &&
        (prepared.sizes[item.index] ?? 0) <
          Math.floor((prepared.upper[item.index] ?? Infinity) + EPSILON),
    )
  ) {
    for (const pivot of [beforeIndex, afterIndex]) {
      const remaining = pivot === beforeIndex ? afterIndex : beforeIndex;
      const pivotFactor = prepared.multipliers[pivot] ?? 1;
      const remainingFactor = prepared.multipliers[remaining] ?? 1;
      for (let unit = 1; unit <= 32; unit += 1) {
        for (const offset of [0, -0.25, 0.25]) {
          const basis = others.reduce(
            (sum, item) =>
              sum +
              ((prepared.sizes[item.index] ?? 0) + offset) /
                (prepared.multipliers[item.index] ?? 1),
            pair / remainingFactor,
          );
          const scale =
            (prepared.weightBudget + unit * (pivotFactor / remainingFactor - 1)) / basis;
          if (!Number.isFinite(scale) || scale <= 0) continue;
          const weights = [...prepared.canonicalWeights];
          weights[pivot] = unit;
          let used = unit;
          for (const item of others) {
            const weight = Math.max(
              1,
              Math.round(
                (scale * ((prepared.sizes[item.index] ?? 0) + offset)) /
                  (prepared.multipliers[item.index] ?? 1),
              ),
            );
            weights[item.index] = weight;
            used += weight;
          }
          weights[remaining] = prepared.weightBudget - used;
          if (weights.every((weight) => Number.isSafeInteger(weight) && weight > 0)) add(weights);
        }
      }
    }
  }
  const otherBasis = prepared.changing.reduce((sum, item) => {
    if (item.index === beforeIndex || item.index === afterIndex) return sum;
    const size = prepared.sizes[item.index] ?? 0;
    return (
      sum +
      (size <= Math.ceil((prepared.lower[item.index] ?? 0) - EPSILON)
        ? 0
        : size / (prepared.multipliers[item.index] ?? 1))
    );
  }, 0);
  const coefficient = (size: number, index: number) =>
    size <= Math.ceil((prepared.lower[index] ?? 0) - EPSILON)
      ? 0
      : size / (prepared.multipliers[index] ?? 1);
  const pairBasis = Math.min(
    coefficient(limits.minimum, beforeIndex) + coefficient(pair - limits.minimum, afterIndex),
    coefficient(limits.maximum, beforeIndex) + coefficient(pair - limits.maximum, afterIndex),
  );
  const maximumScale = prepared.weightBudget / Math.max(Number.MIN_VALUE, otherBasis + pairBasis);
  for (const anchor of anchors) {
    const anchorSize = prepared.sizes[anchor.index] ?? 0;
    const anchorFactor = prepared.multipliers[anchor.index] ?? 1;
    // Large viewports can require a precise ratio between two free panes.
    // Continued-fraction convergents recover the useful integer anchor weights
    // directly; their count depends on canonical precision, never pixel width.
    for (const before of [limits.minimum, limits.maximum]) {
      const values = [...prepared.sizes];
      values[beforeIndex] = before;
      values[afterIndex] = pair - before;
      const endpointScales = new Set<number>();
      for (const index of [beforeIndex, afterIndex]) {
        const ratio = coefficient(values[index] ?? 0, index) / (anchorSize / anchorFactor);
        for (const unit of ratioDenominators(ratio, prepared.weightBudget)) {
          endpointScales.add((unit * anchorFactor) / anchorSize);
        }
      }
      for (const weights of weightsWithBoundSlack(prepared, values, [...endpointScales]))
        add(weights);
    }
    const top = Math.min(
      prepared.weightBudget,
      Math.max(1, Math.ceil((maximumScale * anchorSize) / anchorFactor)),
    );
    for (const unit of criticalUnits(1, top)) {
      for (const offset of [0, -0.25, 0.25]) {
        const scale = (unit * anchorFactor) / (anchorSize + offset);
        if (!Number.isFinite(scale) || scale <= 0) continue;
        const first = Math.max(1, Math.floor((scale * limits.minimum) / beforeFactor));
        const last = Math.min(
          prepared.weightBudget,
          Math.ceil((scale * limits.maximum) / beforeFactor),
        );
        for (const beforeWeight of criticalUnits(first, last)) {
          if (solves >= CRITICAL_STATE_SOLVE_LIMIT) break;
          const before = Math.min(
            limits.maximum,
            Math.max(limits.minimum, (beforeWeight * beforeFactor) / scale),
          );
          const values = [...prepared.sizes];
          values[beforeIndex] = before;
          values[afterIndex] = pair - before;
          for (const weights of weightsWithBoundSlack(prepared, values, [scale], [0, 0.25]))
            add(weights);
        }
      }
    }
  }
  // When every unaffected pane is at a bound, canonical pair-unit transitions
  // still supply a finite useful path without enumerating the viewport pixels.
  for (const endpoint of anchors.length === 0 ? [minimum, maximum] : []) {
    const budget = (endpoint.weights[beforeIndex] ?? 0) + (endpoint.weights[afterIndex] ?? 0);
    for (const beforeWeight of criticalUnits(1, budget - 1)) {
      if (solves >= CRITICAL_STATE_SOLVE_LIMIT) break;
      const weights = [...endpoint.weights];
      weights[beforeIndex] = beforeWeight;
      weights[afterIndex] = budget - beforeWeight;
      add(weights);
    }
  }
  return Object.freeze(
    [...states.values()]
      .sort((left, right) => left.beforeSize - right.beforeSize)
      .map((state) => Object.freeze(state)),
  );
}
