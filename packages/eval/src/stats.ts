/** Nearest-rank percentile (p in (0, 1]) of an ascending array; NaN when empty. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const k = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[k - 1] ?? NaN;
}

export const median = (sorted: readonly number[]): number => percentile(sorted, 0.5);

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Ascending order; NaN sorts as +Infinity (a comparator returning NaN gives an undefined order). */
export const ascending = (xs: readonly number[]): number[] =>
  xs.map((x) => (Number.isNaN(x) ? Infinity : x)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
