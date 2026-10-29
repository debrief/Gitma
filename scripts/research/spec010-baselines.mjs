// Spec 010 FR-010 reporting: medians and P90s of baseline prediction files (naive, per-timestep
// batch least squares) on the G4 rows (σ = 1° turning, manoeuvre_index + 30) and the control rows
// (σ = 1° held course, zig + 30 / zig + 60), as tma-g4's report.json. Prediction files are matched
// by scenario index; their headers are not checked (use only files made from the same scenarios,
// e.g. the same content digest).
//   node scripts/research/spec010-baselines.mjs <split.f32pack> <pred.ndjson>...
import { readFileSync } from "node:fs";
import { readDataset } from "../../packages/data/dist/index.js";
import { angleDiff } from "../../packages/sim/dist/index.js";

const [pack, ...files] = process.argv.slice(2);
const q = (v, p) => [...v].sort((a, b) => a - b)[Math.floor(p * (v.length - 1))];
const out = [];
for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n").filter(Boolean);
  const estimator = JSON.parse(lines[0]).estimator;
  const preds = new Map(
    lines.slice(1).map((l) => {
      const p = JSON.parse(l);
      return [p.scenario_index, p];
    }),
  );
  const acc = {};
  const add = (key, v) => (acc[key] ??= []).push(v);
  for (const s of readDataset(pack).scenarios()) {
    const m = s.metadata;
    if (Math.abs(m.parameters.noise_sigma_rad - Math.PI / 180) > 1e-6) continue;
    const dt = m.parameters.dt_s;
    const p = preds.get(m.index);
    const err = (k) => {
      const r = p?.rows.find((x) => Math.round(x.timestamp_s / dt) === k);
      const o = s.ownship.states[k];
      const t = s.target.states[k];
      if (r === undefined || !r.converged) return { r: Infinity, c: Infinity, v: Infinity };
      const g = Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m);
      return {
        r: Math.abs(r.range_m - g) / g,
        c: Math.abs(angleDiff(r.course_rad, t.course_rad)) * (180 / Math.PI),
        v: Math.abs(r.speed_mps - t.speed_mps) * 1.943844,
      };
    };
    if (m.manoeuvre_index != null) {
      const e = err(m.manoeuvre_index + 30);
      add("turning, manoeuvre+300s|range_rel", e.r);
      add("turning, manoeuvre+300s|course_deg", e.c);
      add("turning, manoeuvre+300s|speed_kt", e.v);
    } else {
      const e = err(m.zig_index + 30);
      add("held course, zig+300s|range_rel", e.r);
      add("held course, zig+300s|course_deg", e.c);
      if (m.zig_index + 60 < m.samples)
        add("held course, zig+600s|speed_kt", err(m.zig_index + 60).v);
    }
  }
  for (const [k, v] of Object.entries(acc)) {
    const [rows, metric] = k.split("|");
    const fin = (x) => (Number.isFinite(x) ? x : null);
    out.push({ estimator, rows, metric, n: v.length, median: fin(q(v, 0.5)), p90: fin(q(v, 0.9)) });
  }
}
console.log(JSON.stringify(out, null, 1));
