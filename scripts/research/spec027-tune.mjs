// Spec 027 (SRD Annex E §E.2): re-tune the classical references to realistic bearing error, on the
// G5 rows of a validation split. As spec012-tune.mjs (decision 29's procedure), with three changes:
//   - every tracker uses the guarded initialisation at level 1 (decision 32's `-g1`);
//   - the objective's ties and reports add median course error (range stays the objective);
//   - an edge rule: if a winner sits on the upper edge of r_scale or p0_scale, that axis is
//     extended by doubling for the stage-2 top settings (EKF: all settings at that edge), scored on
//     all scenarios, until the winner is interior or the axis has been extended four times.
// Objective: median range error over every G5 row (σ = 1°; zig + 5, 10, 15 and 20 min where
// reached; a non-converged row counts as infinite). IMM in two stages (stage 1 on the first
// stage1_scenarios qualifying scenarios, stage 2 re-scores the stage2_top best on all). Ties within
// 0.0005 (absolute) go to the larger r_scale, then the smaller process noise. Worker threads.
//   node scripts/research/spec027-tune.mjs <validation.f32pack> <grid.json> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { ekfName, ekfPredict, immName, immPredict } from "../../packages/classical/dist/index.js";
import { readDataset } from "../../packages/data/dist/index.js";
import { rowError } from "../../packages/eval/dist/errors.js";
import { settled } from "./spec012-distribution.mjs";

const GATE_MIN = [5, 10, 15, 20];
const GUARD = 1;
const estimator = (c) =>
  c.kind === "ekf"
    ? (s) => ekfPredict(s, c.sigmaA, { p0Scale: c.p0Scale, rScale: c.rScale, guardedInit: GUARD })
    : (s) => immPredict(s, { ...c.params, guardedInit: GUARD });
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
    const dt = s.metadata.parameters.dt_s;
    const cut = upTo(s, Math.max(...p.rows.map((r) => r.k)));
    configs.forEach((c, j) => {
      const at = new Map(estimator(c)(cut).rows.map((r) => [Math.round(r.timestamp_s / dt), r]));
      for (const r of p.rows) {
        const row = at.get(r.k);
        const e =
          row === undefined || !row.converged
            ? [Infinity, Infinity]
            : ((x) => [x.range_rel, x.course_deg])(rowError(s, row));
        out[j].push([r.order, e[0], e[1]]);
      }
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
      const row = { order: rows.length, k, t, settled: settled(m, k) };
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
      for (const part of parts) for (const [o, r, c] of part[j]) v.set(o, [r, c]);
      return v;
    });
  };
  const q = (v, p) => {
    const s = Float64Array.from(v).sort();
    return s.length ? s[Math.floor(p * (s.length - 1))] : null;
  };
  const summary = (c, v) => {
    const pick = (f, j) => rows.filter((r) => v.has(r.order) && f(r)).map((r) => v.get(r.order)[j]);
    const all = pick(() => true, 0);
    return {
      ...c,
      name: nameOf(c),
      n_rows: all.length,
      median: q(all, 0.5),
      p90: q(all, 0.9),
      course_median: q(
        pick(() => true, 1),
        0.5,
      ),
      non_converged: all.filter((x) => !Number.isFinite(x)).length / all.length,
      settled: {
        median: q(
          pick((r) => r.settled, 0),
          0.5,
        ),
        course: q(
          pick((r) => r.settled, 1),
          0.5,
        ),
      },
    };
  };
  const scale = (c, k) => (c.kind === "ekf" ? c[k] : c.params[k]);
  const noise = (c) =>
    c.kind === "ekf" ? c.sigmaA : c.params.sigmaCv + c.params.sigmaCt + c.params.sigmaOmega;
  const best = (xs) =>
    [...xs].sort(
      (a, b) =>
        (Math.abs(a.median - b.median) > 0.0005 ? a.median - b.median : 0) ||
        scale(b, "rScale") - scale(a, "rScale") ||
        noise(a) - noise(b),
    )[0];
  const withScale = (c, k, v) =>
    c.kind === "ekf" ? { ...c, [k]: v } : { ...c, params: { ...c.params, [k]: v } };
  const nameOf = (c) =>
    c.kind === "ekf"
      ? ekfName(c.sigmaA, { p0Scale: c.p0Scale, rScale: c.rScale, guardedInit: GUARD })
      : immName({ ...c.params, guardedInit: GUARD });
  const bare = (c) =>
    c.kind === "ekf"
      ? { kind: c.kind, sigmaA: c.sigmaA, p0Scale: c.p0Scale, rScale: c.rScale }
      : { kind: c.kind, params: c.params };
  // The edge rule: extend r_scale / p0_scale by doubling while the winner sits on the upper edge.
  // Candidates are the scored settings at that edge, with the axis doubled.
  const extend = async (scored, axes) => {
    let all = [...scored];
    const log = [];
    for (let round = 0; round < 4; round++) {
      const w = best(all);
      const edges = Object.entries(axes).filter(([k, vals]) => scale(w, k) >= Math.max(...vals));
      if (edges.length === 0) break;
      const seen = new Set(all.map((a) => a.name));
      const fresh = [];
      for (const [k, vals] of edges) {
        const top = Math.max(...vals);
        vals.push(top * 2);
        for (const a of all)
          if (scale(a, k) === top) {
            const c = withScale(bare(a), k, top * 2);
            if (!seen.has(nameOf(c))) {
              seen.add(nameOf(c));
              fresh.push(c);
            }
          }
      }
      log.push({ round, axes: edges.map(([k]) => k), configs: fresh.length });
      all = all.concat((await run(picks, fresh)).map((v, j) => summary(fresh[j], v)));
      lap(`extension ${String(round)}`);
    }
    return { all, log };
  };
  const t0 = Date.now();
  const lap = (what) => console.error(`${what}: ${String((Date.now() - t0) / 1000)} s`);
  const result = {
    grid: gridPath,
    pack,
    guarded_init: GUARD,
    scenarios: picks.length,
    rows: rows.length,
  };
  const ekfs = [];
  for (const sigmaA of grid.ekf.sigma_a)
    for (const p0Scale of grid.ekf.p0_scale)
      for (const rScale of grid.ekf.r_scale) ekfs.push({ kind: "ekf", sigmaA, p0Scale, rScale });
  result.ekf = (await run(picks, ekfs)).map((v, j) => summary(ekfs[j], v));
  lap("EKF grid");
  writeFileSync(outPath, `${JSON.stringify(result, null, 1)}\n`);
  {
    const ext = await extend(result.ekf, {
      rScale: [...grid.ekf.r_scale],
      p0Scale: [...grid.ekf.p0_scale],
    });
    result.ekf = ext.all;
    result.ekf_extensions = ext.log;
  }
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
  const sub = picks.slice(0, grid.stage1_scenarios);
  result.imm_stage1 = (await run(sub, imms)).map((v, j) => summary(imms[j], v));
  lap("IMM stage 1");
  writeFileSync(outPath, `${JSON.stringify(result, null, 1)}\n`);
  const top = [...result.imm_stage1]
    .sort((a, b) => a.median - b.median)
    .slice(0, grid.stage2_top)
    .map(({ kind, params }) => ({ kind, params }));
  result.imm_stage2 = (await run(picks, top)).map((v, j) => summary(top[j], v));
  lap("IMM stage 2");
  {
    const ext = await extend(result.imm_stage2, {
      rScale: [...g.r_scale],
      p0Scale: [...g.p0_scale],
    });
    result.imm_stage2 = ext.all;
    result.imm_extensions = ext.log;
  }
  result.best_ekf = best(result.ekf);
  result.best_imm = best(result.imm_stage2);
  result.seconds = (Date.now() - t0) / 1000;
  writeFileSync(outPath, `${JSON.stringify(result, null, 1)}\n`);
  console.log(JSON.stringify({ ekf: result.best_ekf, imm: result.best_imm }));
}
