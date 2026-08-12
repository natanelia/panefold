import type {
  AllocationItem,
  AxisAllocation,
  AxisConstraints,
  GeometryDiagnostic,
} from "./types.js";

const EPSILON = 1e-9;

interface NormalizedItem {
  readonly key: string;
  readonly index: number;
  readonly min: number;
  readonly preferred: number;
  readonly max: number;
  readonly weight: number;
  readonly grow: number;
  readonly shrink: number;
  readonly collapsible: boolean;
  readonly collapsePriority: number;
  readonly initiallyCollapsed: boolean;
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) || value < 0 ? fallback : value;
}

function normalizeItem(
  item: AllocationItem,
  index: number,
  diagnostics: GeometryDiagnostic[],
): NormalizedItem {
  const input: AxisConstraints = item.constraints ?? {};
  const min = finiteNonNegative(input.min, 0);
  let max =
    input.max === undefined || input.max === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : finiteNonNegative(input.max, min);

  const invalid =
    (input.min !== undefined && (!Number.isFinite(input.min) || input.min < 0)) ||
    (input.preferred !== undefined && (!Number.isFinite(input.preferred) || input.preferred < 0)) ||
    (input.max !== undefined &&
      input.max !== Number.POSITIVE_INFINITY &&
      (!Number.isFinite(input.max) || input.max < 0)) ||
    (input.grow !== undefined && (!Number.isFinite(input.grow) || input.grow < 0)) ||
    (input.shrink !== undefined && (!Number.isFinite(input.shrink) || input.shrink < 0));

  if (max < min) {
    max = min;
  }

  if (invalid || (input.max !== undefined && input.max < min)) {
    diagnostics.push({
      code: "INVALID_CONSTRAINT",
      message: `Invalid constraints for ${item.key} were clamped to safe finite bounds.`,
      itemKeys: [item.key],
    });
  }

  const preferred = Math.min(max, Math.max(min, finiteNonNegative(input.preferred, min)));
  const weight = finiteNonNegative(item.weight, 1) || 1;
  const grow = finiteNonNegative(input.grow, 1);
  const shrink = finiteNonNegative(input.shrink, 1);
  const collapsePriority = Number.isFinite(input.collapsePriority)
    ? (input.collapsePriority ?? 0)
    : 0;

  return {
    key: item.key,
    index,
    min,
    preferred,
    max,
    weight,
    grow,
    shrink,
    collapsible: input.collapsible ?? false,
    collapsePriority,
    initiallyCollapsed: item.collapsed ?? false,
  };
}

function sum(items: readonly NormalizedItem[], select: (item: NormalizedItem) => number): number {
  return items.reduce((total, item) => total + select(item), 0);
}

function boundedFactor(value: number): number {
  if (Number.isFinite(value)) return Math.max(0, value);
  return value > 0 ? Number.MAX_VALUE : 0;
}

/**
 * Finds the proportional allocation whose factor-scaled sizes fit the supplied
 * bounds. Items that hit a bound are frozen and the remainder is solved again.
 */
function allocateProportionally(
  items: readonly NormalizedItem[],
  target: number,
  lowerFor: (item: NormalizedItem) => number,
  upperFor: (item: NormalizedItem) => number,
  factorFor: (item: NormalizedItem) => number,
): number[] {
  const values = Array.from({ length: items.length }, () => 0);
  const pending = new Set(items.map((_, index) => index));
  let remaining = target;

  for (let pass = 0; pass <= items.length && pending.size > 0; pass += 1) {
    const candidates = [...pending].map((index) => {
      const item = items[index];
      if (item === undefined) throw new RangeError("Missing proportional allocation item.");
      return { item, index, factor: boundedFactor(factorFor(item)) };
    });
    const largestFactor = candidates.reduce(
      (largest, candidate) => Math.max(largest, candidate.factor),
      0,
    );
    const factors = candidates.map((candidate) =>
      largestFactor > EPSILON ? candidate.factor / largestFactor : 1,
    );
    const factorTotal = factors.reduce((total, factor) => total + factor, 0);
    let frozeItem = false;

    candidates.forEach(({ item, index }, candidateIndex) => {
      const factor = factors[candidateIndex] ?? 0;
      const proposed = remaining * (factor / factorTotal);
      const lower = lowerFor(item);
      const upper = upperFor(item);
      if (proposed < lower - EPSILON) {
        values[index] = lower;
        remaining -= lower;
        pending.delete(index);
        frozeItem = true;
      } else if (proposed > upper + EPSILON) {
        values[index] = upper;
        remaining -= upper;
        pending.delete(index);
        frozeItem = true;
      }
    });

    if (!frozeItem) {
      candidates.forEach(({ index }, candidateIndex) => {
        const factor = factors[candidateIndex] ?? 0;
        values[index] = remaining * (factor / factorTotal);
      });
      remaining = 0;
      pending.clear();
    }
  }

  if (Math.abs(remaining) > EPSILON && items.length > 0) {
    const lastIndex = items.length - 1;
    values[lastIndex] = (values[lastIndex] ?? 0) + remaining;
  }
  return values;
}

function largestRemainderEqual(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function roundConserving(
  values: readonly number[],
  items: readonly NormalizedItem[],
  target: number,
  minMayBeViolated: boolean,
  maxMayBeViolated: boolean,
): number[] {
  const fractions = values.map((value) => value - Math.floor(value));
  const rounded = values.map((value, index) => {
    const item = items[index];
    if (item === undefined) {
      throw new RangeError("Axis rounding values and items must have identical lengths.");
    }
    const lower = minMayBeViolated ? 0 : Math.ceil(item.min - EPSILON);
    const upper = maxMayBeViolated ? Number.POSITIVE_INFINITY : Math.floor(item.max + EPSILON);
    return Math.min(upper, Math.max(lower, Math.floor(value + EPSILON)));
  });

  let delta = target - rounded.reduce((total, value) => total + value, 0);
  const growOrder = items
    .map((item, index) => ({ item, index, fraction: fractions[index] ?? 0 }))
    .sort((left, right) => right.fraction - left.fraction || left.item.index - right.item.index);
  const shrinkOrder = [...growOrder].sort(
    (left, right) => left.fraction - right.fraction || left.item.index - right.item.index,
  );

  while (delta !== 0) {
    const order = delta > 0 ? growOrder : shrinkOrder;
    let changed = false;

    for (const { item, index } of order) {
      if (delta > 0) {
        if (!maxMayBeViolated && (rounded[index] ?? 0) >= Math.floor(item.max + EPSILON)) continue;
        rounded[index] = (rounded[index] ?? 0) + 1;
        delta -= 1;
      } else {
        const lower = minMayBeViolated ? 0 : Math.ceil(item.min - EPSILON);
        if ((rounded[index] ?? 0) <= lower) continue;
        rounded[index] = (rounded[index] ?? 0) - 1;
        delta += 1;
      }
      changed = true;
      if (delta === 0) break;
    }

    if (!changed) {
      // This can only happen when integer rounding makes declared bounds mutually
      // infeasible. Exact conservation wins and the caller already emits a bound
      // violation diagnostic.
      if (delta > 0) {
        const firstCandidate = growOrder[0];
        if (firstCandidate === undefined) {
          throw new RangeError("Axis rounding requires at least one item.");
        }
        rounded[firstCandidate.index] = (rounded[firstCandidate.index] ?? 0) + delta;
        delta = 0;
      } else {
        for (const { index } of shrinkOrder) {
          const removable = Math.min(rounded[index] ?? 0, -delta);
          rounded[index] = (rounded[index] ?? 0) - removable;
          delta += removable;
          if (delta === 0) break;
        }
      }
    }
  }

  return rounded;
}

/**
 * Deterministically allocates an integer logical-axis length.
 *
 * The algorithm collapses eligible children when hard minima are infeasible,
 * performs bounded weighted water-filling, and finally applies stable
 * largest-remainder rounding. Exact conservation is maintained even in the
 * emergency paths; every violated bound is reported explicitly.
 */
export function allocateAxis(
  inputItems: readonly AllocationItem[],
  availableSize: number,
  requestedSplitterSize = 0,
): AxisAllocation {
  const diagnostics: GeometryDiagnostic[] = [];
  const safeAvailable =
    Number.isFinite(availableSize) && availableSize >= 0 ? Math.round(availableSize) : 0;
  const safeSplitter =
    Number.isFinite(requestedSplitterSize) && requestedSplitterSize >= 0
      ? Math.round(requestedSplitterSize)
      : 0;

  if (safeAvailable !== availableSize) {
    diagnostics.push({
      code: "INVALID_AVAILABLE_SIZE",
      message: `Available size ${String(availableSize)} was rounded or clamped to ${safeAvailable}.`,
    });
  }

  const items = inputItems.map((item, index) => normalizeItem(item, index, diagnostics));
  const firstItem = items[0];
  if (firstItem === undefined) {
    return { sizes: [], activeIndices: [], splitterSizes: [], collapsedKeys: [], diagnostics };
  }

  const active = items.filter((item) => !item.initiallyCollapsed);
  const collapsed = items.filter((item) => item.initiallyCollapsed);
  // A canonical split normally keeps at least one child visible. Be defensive
  // for untrusted/imported state so the result still conserves its full extent.
  if (active.length === 0) {
    active.push(firstItem);
    collapsed.splice(collapsed.indexOf(firstItem), 1);
    diagnostics.push({
      code: "HARD_MIN_VIOLATED",
      message:
        "All children were marked collapsed; the first child was restored as a safe fallback.",
      itemKeys: [firstItem.key],
    });
  }
  const collapseCandidates = items
    .filter((item) => item.collapsible)
    .sort(
      (left, right) => left.collapsePriority - right.collapsePriority || left.index - right.index,
    );

  const fitsHardMin = (): boolean => {
    const splitterCost = Math.max(0, active.length - 1) * safeSplitter;
    return sum(active, (item) => Math.ceil(item.min - EPSILON)) + splitterCost <= safeAvailable;
  };

  for (const candidate of collapseCandidates) {
    if (fitsHardMin() || active.length <= 1) break;
    const activeIndex = active.indexOf(candidate);
    if (activeIndex < 0) continue;
    active.splice(activeIndex, 1);
    collapsed.push(candidate);
    diagnostics.push({
      code: "CHILD_COLLAPSED",
      message: `${candidate.key} was collapsed because hard minima were infeasible.`,
      itemKeys: [candidate.key],
    });
  }

  const splitterCount = Math.max(0, active.length - 1);
  const requestedSplitterTotal = splitterCount * safeSplitter;
  const splitterBudget = Math.min(safeAvailable, requestedSplitterTotal);
  const splitterSizes = largestRemainderEqual(splitterBudget, splitterCount);
  if (splitterBudget < requestedSplitterTotal) {
    diagnostics.push({
      code: "SPLITTER_COMPRESSED",
      message: "Splitters were compressed because they exceeded the available size.",
      itemKeys: active.map((item) => item.key),
    });
  }

  const contentSize = safeAvailable - splitterBudget;
  const minTotal = sum(active, (item) => item.min);
  const roundedMinTotal = sum(active, (item) => Math.ceil(item.min - EPSILON));
  const roundedMaxTotal = sum(active, (item) =>
    Number.isFinite(item.max) ? Math.floor(item.max + EPSILON) : Number.POSITIVE_INFINITY,
  );
  const minViolated = roundedMinTotal > contentSize;
  const maxViolated = roundedMaxTotal < contentSize;

  if (minViolated) {
    diagnostics.push({
      code: "HARD_MIN_VIOLATED",
      message:
        "Hard minima remain infeasible after collapse; emergency proportional shrink was used.",
      itemKeys: active.map((item) => item.key),
    });
  }
  if (maxViolated) {
    diagnostics.push({
      code: "MAX_VIOLATED",
      message: "Declared maxima cannot consume the available size; emergency growth was used.",
      itemKeys: active.map((item) => item.key),
    });
  }

  let values: number[];
  if (minViolated) {
    const basis =
      minTotal > EPSILON ? active.map((item) => item.min) : active.map((item) => item.weight);
    const basisTotal = basis.reduce((total, value) => total + value, 0) || active.length;
    values = basis.map((value) => (contentSize * (value || 1)) / basisTotal);
  } else {
    const roundedPreferredTotal = sum(active, (item) => Math.ceil(item.preferred - EPSILON));
    const preferencesFit = roundedPreferredTotal <= contentSize;
    const lowerFor = preferencesFit
      ? (item: NormalizedItem) => item.preferred
      : (item: NormalizedItem) => item.min;
    const factorFor = preferencesFit
      ? (item: NormalizedItem) => item.weight * item.grow
      : (item: NormalizedItem) => item.weight / Math.max(item.shrink, EPSILON);

    // Canonical weights describe the requested proportions, while preferred
    // sizes are soft floors when they jointly fit. Bounded proportional
    // water-filling makes pointer resize direct: a 60/40 request resolves to
    // 60/40 unless a declared constraint actually prevents it.
    values = allocateProportionally(
      active,
      contentSize,
      lowerFor,
      maxViolated ? () => Number.POSITIVE_INFINITY : (item) => item.max,
      factorFor,
    );
  }

  // Eliminate accumulated floating-point error deterministically before rounding.
  const floatingDelta = contentSize - values.reduce((total, value) => total + value, 0);
  if (Math.abs(floatingDelta) > EPSILON && values.length > 0) {
    const lastIndex = values.length - 1;
    values[lastIndex] = (values[lastIndex] ?? 0) + floatingDelta;
  }

  const activeSizes = roundConserving(values, active, contentSize, minViolated, maxViolated);
  const sizes = Array.from({ length: items.length }, () => 0);
  active.forEach((item, index) => {
    sizes[item.index] = activeSizes[index] ?? 0;
  });

  return {
    sizes,
    activeIndices: active.map((item) => item.index),
    splitterSizes,
    collapsedKeys: collapsed.map((item) => item.key),
    diagnostics,
  };
}
