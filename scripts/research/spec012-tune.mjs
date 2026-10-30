// Spec 012 T006 (FR-003; SRD Annex C §C.3): tune the phase-4 reference trackers on the validation
// split, over G5's rows.
//   node scripts/research/spec012-tune.mjs <validation.f32pack> <configs/phase4/tracker-grid.json> <out.json>
// Objective: the median range error over every G5 row (σ = grid.sigma_deg; zig + 5, 10, 15 and
// 20 min where the window reaches them; non-converged rows count as infinite). Also reported: the
// median on settled rows (Annex C §C.5, `settled` from spec012-distribution.mjs), the median by
// gate time, P90s and the non-converged rate, with per-timestep batch least squares on the same
// rows. The IMM is scored in two stages (stage 1 on the first stage1_scenarios scenarios, stage 2
// re-scores the stage2_top best on all); the EKF grid on all. Worker threads; deterministic.
import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { classicalPredict, ekfPredict, immPredict } from "../../packages/classical/dist/index.js";
import { readDataset } from "../../packages/data/dist/index.js";
import { settled } from "./spec012-distribution.mjs";

const GATE_MIN = [5, 10, 15, 20];
const rangeError = (s, r, k) => {
  const o = s.ownship.states[k];
  const t = s.target.states[k];
  const truth = Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m);
  return r !== undefined && r.converged ? Math.abs(r.range_m - truth) / truth : Infinity;
};
const estimator = (c) =>
  c.kind === "ekf"
    ? (s) => ekfPredict(s, c.sigmaA, { p0Scale: c.p0Scale, rScale: c.rScale })
    : c.kind === "imm"
      ? (s) => immPredict(s, c.params)
      : (s) => classicalPredict(s, "per_timestep");
/** The scenario up to sample k: every estimator here is causal, so rows up to k are unchanged. */
const upTo = (s, k) => ({
  ...s,
  metadata: { ...s.metadata, samples: k + 1 },
  ownship: { ...s.ownship, states: s.ownship.states.slice(0, k + 1) },
  target: { ...s.target, states: s.target.states.slice(0, k + 1) },
  observations: s.observations.slice(0, k + 1),
});

if (!isMainThread) {
  const { pack, picks, configs } = workerData;
  const want = new Map(picks.map((p) => [p.index, p]));
  const out = configs.map(() => []);
  for (const s of readDataset(pack).scenarios()) {
    const p = want.get(s.metadata.index);
    if (p === undefined) continue;
    const first = s.metadata.zig_index + 1;
    const cut = upTo(s, Math.max(...p.rows.map((r) => r.k)));
    configs.forEach((c, j) => {
      const rows = estimator(c)(cut).rows;
      for (const r of p.rows) out[j].push([r.order, rangeError(s, rows[r.k - first], r.k)]);
    });
  }
  parentPort.postMessage(out);
} else {
  const [pack, gridPath, outPath] = process.argv.slice(2);
  const grid = JSON.parse(readFileSync(gridPath, "utf8"));
  const sigma = (grid.sigma_deg * Math.PI) / 180;
  const picks = [];
  const rows = [];
  for (const s of readDataset(pack).scenarios()) {
    const m = s.metadata;
    if (Math.abs(m.parameters.noise_sigma_rad - sigma) > 1e-6) continue;
    const mine = [];
    for (const t of GATE_MIN) {
      const k = m.zig_index + Math.round((t * 60) / m.parameters.dt_s);
      if (k >= m.samples) continue;
      const row = { order: rows.length, k, t, settled: settled(m, k), scenario: picks.length };
      rows.push(row);
      mine.push(row);
    }
    if (mine.length > 0) picks.push({ index: m.index, rows: mine });
  }
  const threads = availableParallelism();
  const run = async (sub, configs) => {
    const chunks = Array.from({ length: threads }, (_, w) =>
      sub.filter((_, i) => i % threads === w),
    );
    const parts = await Promise.all(
      chunks.map(
        (c) =>
          new Promise((res, rej) => {
            const w = new Worker(new URL(import.meta.url), {
              workerData: { pack, picks: c, configs },
            });
            w.on("message", res);
            w.on("error", rej);
          }),
      ),
    );
    return configs.map((_, j) => {
      const v = new Map();
      for (const part of parts) for (const [o, e] of part[j]) v.set(o, e);
      return v;
    });
  };
  const q = (v, p) => {
    const s = [...v].sort((a, b) => a - b);
    return s.length ? s[Math.floor(p * (s.length - 1))] : null;
  };
  const summary = (c, v) => {
    const all = [...v.values()];
    const pick = (f) => rows.filter((r) => v.has(r.order) && f(r)).map((r) => v.get(r.order));
    const settledRows = pick((r) => r.settled);
    return {
      ...c,
      n_rows: all.length,
      median: q(all, 0.5),
      p90: q(all, 0.9),
      non_converged: all.filter((x) => !Number.isFinite(x)).length / all.length,
      settled: { n: settledRows.length, median: q(settledRows, 0.5), p90: q(settledRows, 0.9) },
      unsettled_median: q(
        pick((r) => !r.settled),
        0.5,
      ),
      by_gate_min: Object.fromEntries(
        GATE_MIN.map((t) => [
          t,
          q(
            pick((r) => r.t === t),
            0.5,
          ),
        ]),
      ),
    };
  };
  const ekfs = [];
  for (const sigmaA of grid.ekf.sigma_a)
    for (const p0Scale of grid.ekf.p0_scale)
      for (const rScale of grid.ekf.r_scale) ekfs.push({ kind: "ekf", sigmaA, p0Scale, rScale });
  const imms = [];
  const g = grid.imm;
  for (const sigmaCv of g.sigma_cv)
    for (const sigmaCt of g.sigma_ct)
      for (const sigmaOmega of g.sigma_omega)
        for (const switchPerS of g.switch)
          for (const p0Scale of g.p0_scale)
            for (const rScale of g.r_scale)
              imms.push({
                kind: "imm",
                params: { sigmaCv, sigmaCt, sigmaOmega, switchPerS, p0Scale, rScale },
              });
  const t0 = Date.now();
  const lap = (what) => console.error(`${what}: ${String((Date.now() - t0) / 1000)} s`);
  const result = { grid: gridPath, pack, scenarios: picks.length, rows: rows.length };
  result.lsq = summary({ kind: "lsq" }, (await run(picks, [{ kind: "lsq" }]))[0]);
  lap("least squares");
  writeFileSync(outPath, `${JSON.stringify(result, null, 1)}\n`);
  result.ekf = (await run(picks, ekfs)).map((v, j) => summary(ekfs[j], v));
  lap("EKF grid");
  writeFileSync(outPath, `${JSON.stringify(result, null, 1)}\n`);
  const sub = picks.slice(0, grid.stage1_scenarios);
  result.imm_stage1 = (await run(sub, imms)).map((v, j) => summary(imms[j], v));
  lap("IMM stage 1");
  writeFileSync(outPath, `${JSON.stringify(result, null, 1)}\n`);
  const top = [...result.imm_stage1].sort((a, b) => a.median - b.median).slice(0, grid.stage2_top);
  result.imm_stage2 = (await run(picks, top)).map((v, j) => summary(top[j], v));
  lap("IMM stage 2");
  const best = (xs) => [...xs].sort((a, b) => a.median - b.median)[0];
  result.best_ekf = best(result.ekf);
  result.best_imm = best(result.imm_stage2);
  result.seconds = (Date.now() - t0) / 1000;
  writeFileSync(outPath, `${JSON.stringify(result, null, 1)}\n`);
  console.log(
    JSON.stringify({ lsq: result.lsq.median, ekf: result.best_ekf, imm: result.best_imm }),
  );
}
