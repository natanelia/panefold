/** Shared canonical precision for persisted split proportions. */
export const NORMALIZED_SPLIT_WEIGHT_TOTAL = 1_000_000;

/** Deterministic largest-remainder normalization with child order as tie-breaker. */
export function normalizeSplitWeights(
  weights: readonly number[],
  total = NORMALIZED_SPLIT_WEIGHT_TOTAL,
): readonly number[] {
  if (
    weights.length === 0 ||
    !Number.isSafeInteger(total) ||
    total < weights.length ||
    weights.some((weight) => !Number.isFinite(weight) || weight <= 0)
  ) {
    return [...weights];
  }

  if (
    weights.every((weight) => Number.isSafeInteger(weight)) &&
    weights.reduce((sum, weight) => sum + weight, 0) === total
  ) {
    return [...weights];
  }

  const sum = weights.reduce((value, weight) => value + weight, 0);
  if (!Number.isFinite(sum) || sum <= 0) return [...weights];

  const exact = weights.map((weight) => (weight / sum) * total);
  const result = exact.map((value) => Math.max(1, Math.floor(value)));
  let remainder = total - result.reduce((value, item) => value + item, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  for (const item of order) {
    if (remainder <= 0) break;
    result[item.index] = (result[item.index] ?? 0) + 1;
    remainder -= 1;
  }

  // Extremely small proportions can be rounded up from zero, making the
  // provisional sum exceed the total. Take those units from the largest
  // allocations while preserving the positive-weight invariant.
  if (remainder < 0) {
    const donors = result
      .map((value, index) => ({ index, value }))
      .sort((left, right) => right.value - left.value || left.index - right.index);
    let excess = -remainder;
    for (const donor of donors) {
      if (excess === 0) break;
      const available = Math.max(0, (result[donor.index] ?? 1) - 1);
      const taken = Math.min(available, excess);
      result[donor.index] = (result[donor.index] ?? 1) - taken;
      excess -= taken;
    }
  }
  return result;
}
