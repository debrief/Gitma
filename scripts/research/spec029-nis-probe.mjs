// Run: node scripts/research/spec029-nis-probe.mjs <seed-235 validation.f32pack>. Seed 235 (1,000-scenario
// validation split of a 10,000 generation, phase-7 ranges) is the design probe, never a gate split.
// Result (2026-11-18): straight p50 0.035 p90 0.095; settled-after p50 0.052 p90 0.19; unsettled
// p50 0.058 p90 0.24 (1,304 rows).
// Probe (spec 029 design, seed 235, not a gate split): the EKF's averaged bearing NIS at G5 rows,
// straight legs vs settled-after-manoeuvre vs unsettled. EKF σa 0.03, P0 ×16, R ×64, guarded 1.
import {
  ADAPT_WINDOW,
  ekfBearingNis,
  ekfPredictStep,
  ekfUpdate,
  initialiseAt,
  EKF_MIN_SIGMA_RAD,
} from "../../packages/classical/dist/ekf.js";
import { bearingData } from "../../packages/classical/dist/estimate.js";
import { scenarioSource } from "../../packages/eval/dist/prediction-file.js";
import { g5Rows, straightRow } from "../../packages/eval/dist/gate-g5.js";
const [truth] = process.argv.slice(2);
const groups = { straight: [], settledAfter: [], unsettled: [] };
for (const s of scenarioSource(truth)) {
  const rows = g5Rows([s]);
  if (rows.length === 0) continue;
  const want = new Map(rows.map((r) => [r.k, r]));
  const d = bearingData(s);
  const sigma = s.metadata.parameters.noise_sigma_rad;
  const r2 = Math.max(sigma, EKF_MIN_SIGMA_RAD) ** 2 * 64;
  const first = s.metadata.zig_index + 1;
  let st = initialiseAt(d, first - 1, sigma, 16, 1, false);
  if (st === null) continue;
  let bar = 1;
  for (let i = first; i < s.metadata.samples && st !== null; i++) {
    st = ekfPredictStep(st, d.t[i], 0.03);
    if (d.valid[i] === 1) {
      const e = ekfBearingNis(st, d.bearing[i], d.ownX[i], d.ownY[i], r2);
      bar += (e - bar) / ADAPT_WINDOW;
      st = ekfUpdate(st, d.bearing[i], d.ownX[i], d.ownY[i], r2);
    }
    const r = want.get(i);
    if (r)
      (straightRow(s.metadata, i)
        ? groups.straight
        : r.settled
          ? groups.settledAfter
          : groups.unsettled
      ).push(bar);
  }
}
const q = (a, p) => {
  const b = Float64Array.from(a).sort();
  return b[Math.floor(p * (b.length - 1))];
};
for (const [k, a] of Object.entries(groups))
  console.log(
    k,
    a.length,
    "p10",
    q(a, 0.1).toFixed(4),
    "p50",
    q(a, 0.5).toFixed(4),
    "p90",
    q(a, 0.9).toFixed(4),
  );
