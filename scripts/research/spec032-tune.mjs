// Spec 032 (SRD Annex J §J.2): tune the two classical smoothers on a validation split, by decision
// 29's objective, the median relative range error over the G5 rows (a row with no converged
// estimate is +∞). The EKF smoother's grid is scored on every scenario; the IMM smoother's in two
// stages (every setting on the first `stage1_scenarios` G5 scenarios, then the `stage2_top` best on
// all). Ties within 0.0005 go to the larger r_scale, then the smaller process noise. Four worker
// threads. Prints JSON with every score and best_ekfs / best_imms.
//   node scripts/research/spec032-tune.mjs <truth.f32pack> <grid.json>
import { readFileSync } from "node:fs";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { ekfSmooth } from "../../packages/classical/dist/ekf.js";
import { immSmooth } from "../../packages/classical/dist/imm.js";
import { rowError } from "../../packages/eval/dist/errors.js";
import { g5Rows } from "../../packages/eval/dist/gate-g5.js";
import { scenarioSource } from "../../packages/eval/dist/prediction-file.js";

const median = (a) => {
  const b = Float64Array.from(a).sort();
  return b[Math.floor((b.length - 1) / 2)];
};

function score(truth, settings, limit) {
  const scen = [];
  for (const s of scenarioSource(truth)) {
    if (g5Rows([s]).length === 0) continue;
    scen.push(s);
    if (limit !== undefined && scen.length >= limit) break;
  }
  return settings.map((st) => {
    const errs = [];
    let name = "";
    for (const s of scen) {
      const p = st.kind === "ekf" ? ekfSmooth(s, st.sigmaA, st.scales) : immSmooth(s, st.imm);
      name = p.estimator;
      const dt = s.metadata.parameters.dt_s;
      for (const r of g5Rows([s])) {
        const q = p.rows.find((x) => Math.round(x.timestamp_s / dt) === r.k);
        errs.push(q && q.converged ? rowError(s, q).range_rel : Infinity);
      }
    }
    return { ...st, name, rows: errs.length, median: median(errs) };
  });
}

async function parallel(truth, settings, limit) {
  const parts = 4;
  const chunks = Array.from({ length: parts }, (_, k) =>
    settings.filter((_, i) => i % parts === k),
  );
  const out = await Promise.all(
    chunks.map(
      (chunk) =>
        new Promise((res, rej) => {
          const w = new Worker(new URL(import.meta.url), { workerData: { truth, chunk, limit } });
          w.on("message", res);
          w.on("error", rej);
        }),
    ),
  );
  return out.flat();
}

const noise = (s) =>
  s.kind === "ekf" ? s.sigmaA : s.imm.sigmaCv + s.imm.sigmaCt + s.imm.sigmaOmega + s.imm.switchPerS;
const rOf = (s) => (s.kind === "ekf" ? s.scales.rScale : s.imm.rScale);
const best = (xs) => {
  const m = Math.min(...xs.map((x) => x.median));
  return xs
    .filter((x) => x.median <= m + 0.0005)
    .sort((a, b) => rOf(b) - rOf(a) || noise(a) - noise(b))[0];
};

if (!isMainThread) {
  parentPort.postMessage(score(workerData.truth, workerData.chunk, workerData.limit));
} else {
  const [truth, gridPath] = process.argv.slice(2);
  const g = JSON.parse(readFileSync(gridPath, "utf8"));
  const gi = g.guarded_init;
  const ekf = [];
  for (const sa of g.ekf_smooth.sigma_a)
    for (const p0 of g.ekf_smooth.p0_scale)
      for (const r of g.ekf_smooth.r_scale)
        ekf.push({ kind: "ekf", sigmaA: sa, scales: { p0Scale: p0, rScale: r, guardedInit: gi } });
  const imm = [];
  const I = g.imm_smooth;
  for (const cv of I.sigma_cv)
    for (const ct of I.sigma_ct)
      for (const w of I.sigma_omega)
        for (const sw of I.switch)
          for (const p0 of I.p0_scale)
            for (const r of I.r_scale)
              imm.push({
                kind: "imm",
                imm: {
                  sigmaCv: cv,
                  sigmaCt: ct,
                  sigmaOmega: w,
                  switchPerS: sw,
                  p0Scale: p0,
                  rScale: r,
                  guardedInit: gi,
                },
              });
  const t0 = performance.now();
  const ekfScores = await parallel(truth, ekf);
  const stage1 = await parallel(truth, imm, g.stage1_scenarios);
  const top = [...stage1].sort((a, b) => a.median - b.median).slice(0, g.stage2_top);
  const stage2 = await parallel(
    truth,
    top.map(({ name, rows, median, ...st }) => st),
  );
  const out = {
    truth,
    grid: gridPath,
    ekf_smooth: ekfScores,
    imm_stage1: stage1,
    imm_stage2: stage2,
    best_ekfs: best(ekfScores),
    best_imms: best(stage2),
    seconds: (performance.now() - t0) / 1000,
  };
  console.log(JSON.stringify(out, null, 2));
}
