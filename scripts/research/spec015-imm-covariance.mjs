// Spec 015 R5 (report only): where the frozen reference IMM carries a model covariance that is not
// positive definite, and why. Uses only public exports; changes nothing.
//
//   node scripts/research/spec015-imm-covariance.mjs count <split.f32pack> [level]
//     Scenarios whose IMM state, after any step (`immPredict`'s onStep), has a model covariance
//     that fails a Cholesky test; also steps and non-converged rows. `level` is the guarded
//     initialisation (spec 016: 0, the frozen reference, by default; 1 or 2).
//   node scripts/research/spec015-imm-covariance.mjs batch <split.f32pack> <scenario> <sample>...
//     At each sample: the batch least-squares fit over samples 0..i that `ekfInitialise` uses, its
//     range against the truth, the closest approach of its straight track to ownship, and the
//     eigenvalues of JᵀJ there.
import { readDataset } from "../../packages/data/dist/index.js";
import {
  bearingData,
  immPredict,
  normalEquations,
  solveBatch,
} from "../../packages/classical/dist/index.js";

const REF = {
  sigmaCv: 0.01,
  sigmaCt: 0.03,
  sigmaOmega: 0.01,
  switchPerS: 0.001,
  p0Scale: 4,
  rScale: 8,
};

/** Cholesky test of an n×n row-major symmetric matrix. */
function positiveDefinite(p, n) {
  const l = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    let d = p[(n + 1) * j];
    for (let k = 0; k < j; k++) d -= l[n * j + k] ** 2;
    if (!(d > 0)) return false;
    l[(n + 1) * j] = Math.sqrt(d);
    for (let i = j + 1; i < n; i++) {
      let v = p[n * i + j];
      for (let k = 0; k < j; k++) v -= l[n * i + k] * l[n * j + k];
      l[n * i + j] = v / l[(n + 1) * j];
    }
  }
  return true;
}

/** Eigenvalues of a symmetric n×n matrix (cyclic Jacobi), ascending. */
function eigenvalues(p, n) {
  const a = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => p[n * i + j]));
  for (let sweep = 0; sweep < 200; sweep++)
    for (let r = 0; r < n; r++)
      for (let q = r + 1; q < n; q++) {
        if (a[r][q] === 0) continue;
        const th = (a[q][q] - a[r][r]) / (2 * a[r][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const x = a[k][r];
          const y = a[k][q];
          a[k][r] = c * x - s * y;
          a[k][q] = s * x + c * y;
        }
        for (let k = 0; k < n; k++) {
          const x = a[r][k];
          const y = a[q][k];
          a[r][k] = c * x - s * y;
          a[q][k] = s * x + c * y;
        }
      }
  return a.map((row, i) => row[i]).sort((x, y) => x - y);
}

const [mode, split, ...rest] = process.argv.slice(2);
if (mode === "count") {
  const level = Number(rest[0] ?? 0);
  const params = level === 0 ? REF : { ...REF, guardedInit: level };
  let scenarios = 0;
  let steps = 0;
  let badSteps = 0;
  let rows = 0;
  let nonConverged = 0;
  const bad = [];
  for (const s of readDataset(split).scenarios()) {
    scenarios++;
    let hit = false;
    const p = immPredict(s, params, (_i, st) => {
      steps++;
      if (st.models.some((g) => !positiveDefinite(g.p, 5))) {
        badSteps++;
        hit = true;
      }
    });
    rows += p.rows.length;
    nonConverged += p.rows.filter((r) => !r.converged).length;
    if (hit) bad.push(s.metadata.index);
  }
  console.log(
    JSON.stringify({
      level,
      scenarios,
      with_non_pd_state: bad.length,
      steps,
      non_pd_steps: badSteps,
      rows,
      non_converged_rows: nonConverged,
      indices: bad,
    }),
  );
} else if (mode === "batch") {
  const [idx, ...samples] = rest.map(Number);
  let s;
  for (const x of readDataset(split).scenarios())
    if (x.metadata.index === idx) {
      s = x;
      break;
    }
  if (s === undefined) throw new Error(`scenario ${String(idx)} not in ${split}`);
  const d = bearingData(s);
  for (const i of samples) {
    const sol = solveBatch(d, i + 1);
    if (sol === null) {
      console.log(JSON.stringify({ sample: i, batch: null }));
      continue;
    }
    const [x0, y0, vx, vy] = sol.theta;
    let closest = Infinity;
    let closestAt = -1;
    for (let k = 0; k <= i; k++) {
      if (d.valid[k] !== 1) continue;
      const rho = Math.hypot(x0 + vx * d.t[k] - d.ownX[k], y0 + vy * d.t[k] - d.ownY[k]);
      if (rho < closest) {
        closest = rho;
        closestAt = k;
      }
    }
    const ti = d.t[i];
    const tgt = s.target.states[i];
    const own = s.ownship.states[i];
    const { jtj } = normalEquations(d, sol.theta, i + 1);
    console.log(
      JSON.stringify({
        sample: i,
        batch_range_m: Math.round(Math.hypot(x0 + vx * ti - d.ownX[i], y0 + vy * ti - d.ownY[i])),
        true_range_m: Math.round(Math.hypot(tgt.x_m - own.x_m, tgt.y_m - own.y_m)),
        closest_approach_m: Number(closest.toPrecision(3)),
        closest_at_sample: closestAt,
        jtj_eigenvalues: eigenvalues(jtj, 4).map((v) => Number(v.toExponential(3))),
        jtj_positive_definite: positiveDefinite(jtj, 4),
      }),
    );
  }
} else {
  console.error(
    "usage: spec015-imm-covariance.mjs count <split> | batch <split> <scenario> <sample>...",
  );
  process.exitCode = 2;
}
