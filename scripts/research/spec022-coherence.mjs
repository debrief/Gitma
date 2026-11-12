// Spec 022 (G8 panel phase 10, geometry; reported, not gated): the hybrid's row composition and
// kinematic coherence on the first N scenarios of a split, from the gate's prediction files.
// - Composition: each hybrid row against its expected row (T2's, with the fused tracker's course and
//   speed; T2's whole row where the fused tracker is not converged; the fused row where T2 is not).
// - Bearing residuals: the realistic error is in the scored data.
// - On G5 rows, for the hybrid, fused tracker, T2 and IMM: implied bearing-rate and range-rate
//   errors, bearing of the estimated position, and the kinematic gap between the position change
//   over 60 s and the stated velocity. Written by the geometry reviewer; committed for the record.
//   node scripts/research/spec022-coherence.mjs <data dir with test.f32pack and pred/> [N]
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
const R = new URL("../../", import.meta.url).pathname;
const DATA = process.argv[2];
if (DATA === undefined) {
  console.error("usage: spec022-coherence.mjs <data dir> [N]");
  process.exit(2);
}
const { scenarioSource } = await import(R + "packages/eval/dist/prediction-file.js");
const { rowError } = await import(R + "packages/eval/dist/errors.js");
const { g5Rows } = await import(R + "packages/eval/dist/gate-g5.js");
const N = Number(process.argv[3] ?? 400);
async function head(f, n) {
  const out = [];
  const rl = createInterface({ input: createReadStream(f) });
  for await (const l of rl) {
    if (out.length > n) break;
    out.push(l);
  }
  rl.close();
  return out.slice(1).map((l) => JSON.parse(l));
}
const D = `${DATA}/pred/test.`;
const [H, F, T, I] = await Promise.all(
  ["hybrid", "fused", "t2", "imm"].map((x) => head(D + x + ".ndjson", N)),
);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const med = (v) => {
  const b = [...v].filter(Number.isFinite).sort((a, b) => a - b);
  return b[Math.floor((b.length - 1) / 2)];
};
const p90 = (v) => {
  const b = [...v].filter(Number.isFinite).sort((a, b) => a - b);
  return b[Math.floor(0.9 * (b.length - 1))];
};
let mism = 0,
  rowsN = 0,
  t2whole = 0,
  fusedVel = 0,
  t2nc = 0;
const brErr = { hyb: [], fused: [], t2: [], imm: [] },
  rrErr = { hyb: [], fused: [], t2: [] };
const bearErr = { hyb: [], fused: [], t2: [] },
  rangeCons = [],
  kinGap = { hyb: [], fused: [], t2: [] };
const resid = { var: [], rho1: [], sig: [], mean: [] };
let i = 0,
  g5n = 0,
  g5sig = 0;
const vel = (sp, c) => [sp * Math.sin(c), sp * Math.cos(c)];
for (const s of scenarioSource(`${DATA}/test.f32pack`)) {
  if (i >= N) break;
  const h = H[i],
    f = F[i],
    t = T[i],
    im = I[i];
  i++;
  for (const p of [h, f, t, im])
    if (p.scenario_index !== s.metadata.index)
      throw new Error("order " + p.scenario_index + " " + s.metadata.index);
  const dt = s.metadata.parameters.dt_s;
  // row composition
  h.rows.forEach((hr, k) => {
    const fr = f.rows[k],
      tr = t.rows[k];
    rowsN++;
    let exp;
    if (!tr.converged) {
      exp = fr;
      t2nc++;
    } else if (!fr.converged) {
      exp = tr;
      t2whole++;
    } else {
      exp = { ...tr, course_rad: fr.course_rad, speed_mps: fr.speed_mps };
      delete exp.vx_sd_mps;
      delete exp.vy_sd_mps;
      fusedVel++;
    }
    const ks = new Set([...Object.keys(exp), ...Object.keys(hr)]);
    for (const key of ks)
      if (exp[key] !== hr[key]) {
        mism++;
        if (mism < 5) console.log("mismatch", s.metadata.index, k, key, exp[key], hr[key]);
      }
  });
  // bearing residuals (sigma>0)
  const sig = s.metadata.parameters.noise_sigma_rad;
  if (sig > 0) {
    const r = [];
    s.observations.forEach((o, k) => {
      if (!o.valid) {
        r.push(NaN);
        return;
      }
      const O = s.ownship.states[k],
        Tt = s.target.states[k];
      r.push(wrap(o.bearing_rad - Math.atan2(Tt.x_m - O.x_m, Tt.y_m - O.y_m)));
    });
    const v = r.filter(Number.isFinite);
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const va = v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length;
    // lag-1 autocorr of first differences removed? use raw
    let num = 0,
      den = 0;
    for (let k = 1; k < r.length; k++)
      if (Number.isFinite(r[k]) && Number.isFinite(r[k - 1])) {
        num += (r[k] - m) * (r[k - 1] - m);
        den++;
      }
    resid.var.push(va / sig ** 2);
    resid.rho1.push(num / den / va);
    resid.sig.push(sig);
    resid.mean.push((Math.abs(m) * 180) / Math.PI);
  }
  // G5 rows geometry
  for (const g of g5Rows([s])) {
    g5n++;
    const k = g.k;
    const O = s.ownship.states[k],
      Tt = s.target.states[k];
    const dx = Tt.x_m - O.x_m,
      dy = Tt.y_m - O.y_m,
      rng = Math.hypot(dx, dy);
    const vo = vel(O.speed_mps, O.course_rad),
      vt = vel(Tt.speed_mps, Tt.course_rad);
    const bdotT = (dy * (vt[0] - vo[0]) - dx * (vt[1] - vo[1])) / rng ** 2;
    const rdotT = (dx * (vt[0] - vo[0]) + dy * (vt[1] - vo[1])) / rng;
    const obs = s.observations[k];
    const at = (P, kk) => P.rows.find((x) => Math.round(x.timestamp_s / dt) === kk);
    const est = { hyb: at(h, k), fused: at(f, k), t2: at(t, k), imm: at(im, k) };
    if (!est.hyb || !est.imm) {
      console.log("missing row", s.metadata.index, k);
      continue;
    }
    for (const [n, e] of Object.entries(est)) {
      if (!e.converged) {
        brErr[n].push(Infinity);
        continue;
      }
      const ex = e.x_m - O.x_m,
        ey = e.y_m - O.y_m,
        er = Math.hypot(ex, ey);
      const ve = vel(e.speed_mps, e.course_rad);
      const bd = (ey * (ve[0] - vo[0]) - ex * (ve[1] - vo[1])) / er ** 2;
      brErr[n].push(((Math.abs(bd - bdotT) * 180) / Math.PI) * 60); // deg/min
      if (rrErr[n])
        rrErr[n].push(Math.abs((ex * (ve[0] - vo[0]) + ey * (ve[1] - vo[1])) / er - rdotT));
      if (bearErr[n])
        bearErr[n].push((Math.abs(wrap(Math.atan2(ex, ey) - Math.atan2(dx, dy))) * 180) / Math.PI);
      if (n === "hyb") rangeCons.push(Math.abs(er - e.range_m) / e.range_m);
      // kinematic gap: position change over next 6 samples (60 s) vs velocity*60
      const P = { hyb: h, fused: f, t2: t }[n];
      const e2 = P ? at(P, k + 6) : undefined;
      if (kinGap[n] && e2 && e2.converged) {
        const pvx = (e2.x_m - e.x_m) / (6 * dt),
          pvy = (e2.y_m - e.y_m) / (6 * dt);
        kinGap[n].push(Math.hypot(pvx - ve[0], pvy - ve[1]) * 1.94384);
      }
    }
    if (Math.abs(s.metadata.parameters.noise_sigma_rad - Math.PI / 180) < 1e-6) g5sig++;
  }
}
const f = (x) => (typeof x === "number" ? x.toPrecision(4) : x);
console.log({ scenarios: i, rowsN, mism, t2nc, t2whole, fusedVel, g5n, g5sig });
console.log(
  "resid var/sig^2 med",
  f(med(resid.var)),
  "rho1 med",
  f(med(resid.rho1)),
  "|mean| deg med",
  f(med(resid.mean)),
  "n",
  resid.var.length,
);
for (const n of ["hyb", "fused", "t2", "imm"])
  console.log("bearing-rate err deg/min", n, "med", f(med(brErr[n])), "p90", f(p90(brErr[n])));
for (const n of ["hyb", "fused", "t2"])
  console.log(
    "range-rate err m/s",
    n,
    f(med(rrErr[n])),
    f(p90(rrErr[n])),
    " bearing err deg",
    f(med(bearErr[n])),
    f(p90(bearErr[n])),
    " kin gap kt",
    f(med(kinGap[n])),
    f(p90(kinGap[n])),
  );
console.log(
  "hybrid |pos-ownship| vs range_m rel med/max",
  f(med(rangeCons)),
  f(Math.max(...rangeCons)),
);
