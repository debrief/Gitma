// Plan-view geometry (spec 006 FR-003): bounds, a 1–2–5 grid between 100 m and 10 km, labels.

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const GRID_MIN_M = 100;
export const GRID_MAX_M = 10_000;

/** The 1–2–5 × 10ⁿ step giving about `lines` grid lines across `span` metres, within 100 m–10 km. */
export function gridStep(span: number, lines = 8): number {
  if (!(span > 0)) return GRID_MIN_M;
  const raw = span / lines;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  const nice = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  return Math.min(GRID_MAX_M, Math.max(GRID_MIN_M, nice));
}

/** Grid line positions covering [lo, hi] at `step`, aligned to multiples of it. */
export function gridLines(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v + 0);
  return out;
}

/** Bounds of the points with a margin, at least `minSpan` metres wide and tall, centred. */
export function boundsOf(
  points: Iterable<readonly [number, number]>,
  margin = 0.08,
  minSpan = 2000,
): Bounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX))
    return { minX: -minSpan / 2, maxX: minSpan / 2, minY: -minSpan / 2, maxY: minSpan / 2 };
  const w = Math.max(maxX - minX, minSpan);
  const h = Math.max(maxY - minY, minSpan);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const half = (Math.max(w, h) * (1 + 2 * margin)) / 2;
  return { minX: cx - half, maxX: cx + half, minY: cy - half, maxY: cy + half };
}

/** "500 m", "2 km", "1.5 km". */
export function formatDistance(m: number): string {
  const a = Math.abs(m);
  if (a < 1000) return `${String(Math.round(m))} m`;
  const km = m / 1000;
  return `${Number.isInteger(km) ? String(km) : km.toFixed(1)} km`;
}
