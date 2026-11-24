// Small dense-matrix helpers for the smoothers (spec 032). Row-major n × n arrays.

/** Inverse of an n × n matrix by Gauss–Jordan with partial pivoting; null if (near) singular. */
export function invert(a: Float64Array, n: number): Float64Array | null {
  const m = Float64Array.from(a);
  const inv = new Float64Array(n * n);
  for (let i = 0; i < n; i++) inv[n * i + i] = 1;
  for (let c = 0; c < n; c++) {
    let piv = c;
    let best = Math.abs(m[n * c + c] ?? 0);
    for (let r = c + 1; r < n; r++) {
      const v = Math.abs(m[n * r + c] ?? 0);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (!(best > 1e-300) || !Number.isFinite(best)) return null;
    if (piv !== c)
      for (let k = 0; k < n; k++) {
        const t1 = m[n * c + k] ?? 0;
        m[n * c + k] = m[n * piv + k] ?? 0;
        m[n * piv + k] = t1;
        const t2 = inv[n * c + k] ?? 0;
        inv[n * c + k] = inv[n * piv + k] ?? 0;
        inv[n * piv + k] = t2;
      }
    const d = m[n * c + c] ?? 1;
    for (let k = 0; k < n; k++) {
      m[n * c + k] = (m[n * c + k] ?? 0) / d;
      inv[n * c + k] = (inv[n * c + k] ?? 0) / d;
    }
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[n * r + c] ?? 0;
      if (f === 0) continue;
      for (let k = 0; k < n; k++) {
        m[n * r + k] = (m[n * r + k] ?? 0) - f * (m[n * c + k] ?? 0);
        inv[n * r + k] = (inv[n * r + k] ?? 0) - f * (inv[n * c + k] ?? 0);
      }
    }
  }
  return inv;
}

/** a (n × n) times b (n × n). */
export function matmul(a: Float64Array, b: Float64Array, n: number): Float64Array {
  const c = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < n; k++) {
      const v = a[n * i + k] ?? 0;
      if (v === 0) continue;
      for (let j = 0; j < n; j++) c[n * i + j] = (c[n * i + j] ?? 0) + v * (b[n * k + j] ?? 0);
    }
  return c;
}

/** Transpose of an n × n matrix. */
export function transposeN(a: Float64Array, n: number): Float64Array {
  const t = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) t[n * j + i] = a[n * i + j] ?? 0;
  return t;
}

/** m (n × n) times v (n). */
export function matvec(m: Float64Array, v: ArrayLike<number>, n: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += (m[n * i + j] ?? 0) * (v[j] ?? 0);
    out[i] = s;
  }
  return out;
}
