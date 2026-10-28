// Spec 010 T010 (FR-004, FR-011): tune the phase-3 trackers on the validation split.
//   node scripts/research/spec010-tune.mjs <validation.f32pack> <configs/phase3/tracker-grid.json> <out.json>
// Writes every configuration's median, P90 and non-converged rate at the gate rows, for the turning
// (tuned-turn) and held-course (tuned-straight) scenarios at σ = grid.sigma_deg, plus per-timestep
// batch least squares on the same rows. Runs on all cores with worker threads; deterministic.
import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { classicalPredict, ekfPredict, immPredict } from "../../packages/classical/dist/index.js";
import { readDataset } from "../../packages/data/dist/index.js";

const rowError = (s, r, k) => {
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

if (!isMainThread) {
  const { pack, picks, configs } = workerData;
  const want = new Map(picks.map((p) => [p.index, p]));
  const out = configs.map(() => []);
  for (const s of readDataset(pack).scenarios()) {
    const p = want.get(s.metadata.index);
    if (p === undefined) continue;
    const first = s.metadata.zig_index + 1;
    configs.forEach((c, j) => {
      out[j].push([p.order, rowError(s, estimator(c)(s).rows[p.k - first], p.k)]);
    });
  }
  parentPort.postMessage(out);
} else {
  const [pack, gridPath, outPath] = process.argv.slice(2);
  const grid = JSON.parse(readFileSync(gridPath, "utf8"));
  const sigma = (grid.sigma_deg * Math.PI) / 180;
  const turn = [];
  const held = [];
  for (const s of readDataset(pack).scenarios()) {
    const m = s.metadata;
    if (Math.abs(m.parameters.noise_sigma_rad - sigma) > 1e-6) continue;
    const turns = m.manoeuvre_index != null;
    const k = (turns ? m.manoeuvre_index : m.zig_index) + grid.gate_offset_samples;
    if (k >= m.samples) continue;
    (turns ? turn : held).push({ index: m.index, k });
  }
  const threads = availableParallelism();
  const run = async (picks, configs) => {
    const ordered = picks.map((p, order) => ({ ...p, order }));
    const chunks = Array.from({ length: threads }, (_, w) =>
      ordered.filter((_, i) => i % threads === w),
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
      const v = new Array(picks.length);
      for (const part of parts) for (const [o, e] of part[j]) v[o] = e;
      return v;
    });
  };
  const q = (v, p) => {
    const s = [...v].sort((a, b) => a - b);
    return s[Math.floor(p * (s.length - 1))];
  };
  const summary = (c, v) => ({
    ...c,
    n: v.length,
    median: q(v, 0.5),
    p90: q(v, 0.9),
    non_converged: v.filter((x) => !Number.isFinite(x)).length / v.length,
  });
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
  const result = { grid: gridPath, pack, n_turn: turn.length, n_held: held.length };
  for (const [name, picks] of [
    ["turn", turn],
    ["straight", held],
  ]) {
    const t0 = Date.now();
    const lsq = (await run(picks, [{ kind: "lsq" }]))[0];
    const ekf = (await run(picks, ekfs)).map((v, j) => summary(ekfs[j], v));
    const sub = picks.slice(0, grid.stage1_scenarios);
    const stage1 = (await run(sub, imms)).map((v, j) => summary(imms[j], v));
    const top = [...stage1].sort((a, b) => a.median - b.median).slice(0, grid.stage2_top);
    const stage2 = (await run(picks, top)).map((v, j) => summary(top[j], v));
    const best = (xs) => [...xs].sort((a, b) => a.median - b.median)[0];
    result[name] = {
      lsq: summary({ kind: "lsq" }, lsq),
      ekf,
      imm_stage1: stage1,
      imm_stage2: stage2,
      best_ekf: best(ekf),
      best_imm: best(stage2),
      seconds: (Date.now() - t0) / 1000,
    };
    console.error(`${name}: ${String(picks.length)} scenarios, ${String(result[name].seconds)} s`);
  }
  writeFileSync(outPath, `${JSON.stringify(result, null, 1)}\n`);
  for (const k of ["turn", "straight"])
    console.log(
      k,
      JSON.stringify({
        lsq: result[k].lsq.median,
        ekf: result[k].best_ekf,
        imm: result[k].best_imm,
      }),
    );
}
