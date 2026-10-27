// Spec 009 research R1 only (not shipped): the per-leg steady-track fit, compiled from the TypeScript
// once written for packages/features and withdrawn when R1 showed it carries no usable range-rate
// on young legs. See specs/009-iteration-5-hybrid/research.md, R1.
// Per-leg steady-track fit (spec 009; spec 003 research R18). Pure functions over numeric arrays
// (constitution III): no classes, no hidden state, no target truth.
//
// Within one ownship leg both platforms hold course and speed, so the relative position is a
// straight line, p(τ) = p₀ + w·τ, and each bearing b satisfies p_x cos b − p_y sin b = 0. Each
// observed row of the leg so far is one homogeneous linear equation in θ = (p₀, w); the fit is
// the least-squares θ up to scale: the eigenvector of the smallest eigenvalue of AᵀA. Range
// cancels (the scale), so the fit gives only scale-free quantities at row t:
//
// - the bearing rate ḃ = (p_y w_x − p_x w_y) / |p|²   (rad/s),
// - the range-rate ratio ṙ/r = (p · w) / |p|²          (1/s),
// - the residual, √(λ_min / m) / |p̄|, an RMS bearing misfit in rad (p̄ at the leg's mean time),
// - the leg's age (s since its first straight row).
//
// The fit at row t uses only rows of the current leg up to t (causal). A row is on a leg when
// ownship's course and speed equal the previous row's; a turn row ends the leg, and the next
// straight row starts a new one. Rows in turns, dropout rows and rows with fewer than
// MIN_LEG_SAMPLES observed rows in the leg so far have no fit (valid 0, every value 0).
/** Fewer observed rows than this in the leg so far ⇒ no fit. */
export const MIN_LEG_SAMPLES = 6;
/** Time unit inside the fit (s), for conditioning: τ is in hundreds of seconds. */
const TAU_UNIT_S = 100;
/**
 * Eigenvector of the smallest eigenvalue of a symmetric 4×4 matrix (row-major), by cyclic Jacobi
 * rotations (deterministic: fixed sweep order and count). Returns [λ_min, v₀, v₁, v₂, v₃].
 */
export function smallestEigen4(m) {
  const a = Array.from({ length: 16 }, (_, i) => m[i] ?? 0);
  const v = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += (a[p * 4 + q] ?? 0) ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 4; q++) {
        const apq = a[p * 4 + q] ?? 0;
        if (apq === 0) continue;
        const app = a[p * 5] ?? 0;
        const aqq = a[q * 5] ?? 0;
        const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        for (let k = 0; k < 4; k++) {
          const akp = a[k * 4 + p] ?? 0;
          const akq = a[k * 4 + q] ?? 0;
          a[k * 4 + p] = c * akp - s * akq;
          a[k * 4 + q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = a[p * 4 + k] ?? 0;
          const aqk = a[q * 4 + k] ?? 0;
          a[p * 4 + k] = c * apk - s * aqk;
          a[q * 4 + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = v[k * 4 + p] ?? 0;
          const vkq = v[k * 4 + q] ?? 0;
          v[k * 4 + p] = c * vkp - s * vkq;
          v[k * 4 + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if ((a[i * 5] ?? 0) < (a[best * 5] ?? 0)) best = i;
  return [a[best * 5] ?? 0, v[best] ?? 0, v[4 + best] ?? 0, v[8 + best] ?? 0, v[12 + best] ?? 0];
}
/**
 * Per-leg fit for rows 0..n−1 from bearings, their validity, times and ownship course and speed
 * (inputs only). Row t depends only on rows ≤ t (causality).
 */
export function legFit(
  time_s,
  bearing_rad,
  observed,
  ownCourse_rad,
  ownSpeed_mps,
  n,
  minSamples = MIN_LEG_SAMPLES,
) {
  const out = {
    bearingRate: new Float64Array(n),
    rangeRateRatio: new Float64Array(n),
    residual: new Float64Array(n),
    legAge: new Float64Array(n),
    valid: new Uint8Array(n),
  };
  // AᵀA of the current leg (row-major 4×4), its row count, Σ τ, and the leg's start time.
  const ata = new Float64Array(16);
  let m = 0;
  let sumTau = 0;
  let start = NaN;
  for (let t = 0; t < n; t++) {
    const tt = time_s[t] ?? NaN;
    const straight =
      t === 0 ||
      ((ownCourse_rad[t] ?? NaN) === (ownCourse_rad[t - 1] ?? NaN) &&
        (ownSpeed_mps[t] ?? NaN) === (ownSpeed_mps[t - 1] ?? NaN));
    if (!straight) {
      ata.fill(0);
      m = 0;
      sumTau = 0;
      start = NaN;
      continue;
    }
    if (Number.isNaN(start)) start = tt;
    out.legAge[t] = tt - start;
    if (observed[t] === true) {
      const b = bearing_rad[t] ?? NaN;
      const tau = (tt - start) / TAU_UNIT_S;
      const c = Math.cos(b);
      const s = Math.sin(b);
      const row = [c, -s, tau * c, -tau * s];
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++)
          ata[i * 4 + j] = (ata[i * 4 + j] ?? 0) + (row[i] ?? 0) * (row[j] ?? 0);
      m++;
      sumTau += tau;
    }
    if (observed[t] !== true || m < minSamples) continue;
    const [lambda = 0, p0x = 0, p0y = 0, wx = 0, wy = 0] = smallestEigen4(ata);
    // Relative position now and at the leg's mean time, in units where |θ| = 1; w per τ unit.
    const now = (tt - start) / TAU_UNIT_S;
    const px = p0x + wx * now;
    const py = p0y + wy * now;
    const r2 = px * px + py * py;
    const mean = sumTau / m;
    const pm = Math.hypot(p0x + wx * mean, p0y + wy * mean);
    if (!(r2 > 1e-12) || !(pm > 1e-6)) continue;
    // θ is defined up to sign; ḃ and ṙ/r are ratios of products of p and w, so the sign cancels.
    const rate = (py * wx - px * wy) / r2 / TAU_UNIT_S;
    const ratio = (px * wx + py * wy) / r2 / TAU_UNIT_S;
    const res = Math.sqrt(Math.max(0, lambda) / m) / pm;
    if (!Number.isFinite(rate) || !Number.isFinite(ratio) || !Number.isFinite(res)) continue;
    out.bearingRate[t] = rate;
    out.rangeRateRatio[t] = ratio;
    out.residual[t] = res;
    out.valid[t] = 1;
  }
  return out;
}
