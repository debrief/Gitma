// Spec 011 FR-004 reporting: the two-hypothesis network's turn flag (p_manoeuvre) against the
// truth, and its held-course errors split by the hypothesis it reported. σ = 1° rows only.
// - Turning scenarios: delay from the turn's first sample (manoeuvre_start_index) to the first row
//   with p > 0.5; a miss if none by the G4 row (manoeuvre_index + 300 s). Early alarms: p > 0.5 on
//   some row before the turn starts.
// - Held-course scenarios: false-alarm share at zig + 300 s and zig + 600 s, and the share with
//   p > 0.5 on any row.
// - AUC of p at zig + 300 s against the truth label (course differs from row 0's) on all rows.
// - Held course, zig + 600 s: signed speed error by the reported hypothesis; |course| by time.
// Prediction files are matched by scenario index; use files made from the same scenarios.
//   node scripts/research/spec011-detection.mjs <split.f32pack> <two-hypothesis pred.ndjson> [<other pred.ndjson>]...
import { readFileSync } from "node:fs";
import { readDataset } from "../../packages/data/dist/index.js";
import { angleDiff } from "../../packages/sim/dist/index.js";

const [pack, net, ...others] = process.argv.slice(2);
const KT = 3600 / 1852;
const load = (f) => {
  const lines = readFileSync(f, "utf8").split("\n").filter(Boolean);
  const m = new Map();
  for (const l of lines.slice(1)) {
    const p = JSON.parse(l);
    m.set(p.scenario_index, p);
  }
  return { estimator: JSON.parse(lines[0]).estimator, byIndex: m };
};
const q = (v, p) =>
  v.length ? [...v].sort((a, b) => a - b)[Math.floor(p * (v.length - 1))] : null;
const share = (v) => (v.length ? v.filter(Boolean).length / v.length : null);
const sets = [net, ...others].map(load);
const N = sets[0];

const delays = [];
let misses = 0;
let turning = 0;
const early = [];
const faAt = { 300: [], 600: [] };
const faAny = [];
const auc = { pos: [], neg: [] };
const held = sets.map(() => ({ speed: [], byMin: {} }));
const speedByHyp = { held: [], turned: [] };

for (const s of readDataset(pack).scenarios()) {
  const m = s.metadata;
  if (Math.abs(m.parameters.noise_sigma_rad - Math.PI / 180) > 1e-6) continue;
  const dt = m.parameters.dt_s;
  const p = N.byIndex.get(m.index);
  if (p === undefined) throw new Error(`no prediction for scenario ${m.index}`);
  const at = (set, k) =>
    set.byIndex.get(m.index)?.rows.find((r) => Math.round(r.timestamp_s / dt) === k);
  const pk = (r) => r?.p_manoeuvre ?? NaN;
  const k300 = m.zig_index + Math.round(300 / dt);
  if (k300 < m.samples) {
    const r = at(N, k300);
    const c0 = s.target.states[0].course_rad;
    const label = s.target.states[k300].course_rad !== c0;
    if (r) (label ? auc.pos : auc.neg).push(pk(r));
  }
  if (m.manoeuvre_index != null) {
    turning++;
    const start = m.manoeuvre_start_index;
    const g4 = m.manoeuvre_index + Math.round(300 / dt);
    let first = null;
    let alarmBefore = false;
    for (const r of p.rows) {
      const k = Math.round(r.timestamp_s / dt);
      if (k < start && pk(r) > 0.5) alarmBefore = true;
      if (k >= start && k <= g4 && pk(r) > 0.5 && first === null) first = k;
    }
    early.push(alarmBefore);
    if (first === null) misses++;
    else delays.push((first - start) * dt);
  } else {
    faAny.push(p.rows.some((r) => pk(r) > 0.5));
    for (const off of [300, 600]) {
      const k = m.zig_index + Math.round(off / dt);
      if (k >= m.samples) continue;
      const r = at(N, k);
      if (r) faAt[off].push(pk(r) > 0.5);
    }
    const k600 = m.zig_index + Math.round(600 / dt);
    sets.forEach((set, i) => {
      if (k600 < m.samples) {
        const r = at(set, k600);
        if (r?.converged) {
          const e = (r.speed_mps - s.target.states[k600].speed_mps) * KT;
          held[i].speed.push(e);
          if (i === 0) (pk(r) > 0.5 ? speedByHyp.turned : speedByHyp.held).push(e);
        }
      }
      for (const mins of [2, 5, 10, 15]) {
        const k = m.zig_index + Math.round((mins * 60) / dt);
        if (k >= m.samples) continue;
        const r = at(set, k);
        if (!r?.converged) continue;
        (held[i].byMin[mins] ??= []).push(
          (Math.abs(angleDiff(r.course_rad, s.target.states[k].course_rad)) * 180) / Math.PI,
        );
      }
    });
  }
}

// AUC by ranks (ties count half).
let wins = 0;
const neg = Float64Array.from(auc.neg).sort();
for (const x of auc.pos) {
  let lo = 0;
  let hi = neg.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (neg[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  let eq = lo;
  while (eq < neg.length && neg[eq] === x) eq++;
  wins += lo + (eq - lo) / 2;
}
const abs = (v) => v.map(Math.abs);
const out = {
  estimator: N.estimator,
  turn_flag: {
    turning_scenarios: turning,
    delay_s: { n: delays.length, median: q(delays, 0.5), p10: q(delays, 0.1), p90: q(delays, 0.9) },
    missed_by_g4_row: misses / turning,
    alarm_before_turn_starts: share(early),
    held_false_alarm_zig300: share(faAt[300]),
    held_false_alarm_zig600: share(faAt[600]),
    held_alarm_any_row: share(faAny),
    auc_zig300: wins / (auc.pos.length * auc.neg.length),
    auc_n: { turned: auc.pos.length, held: auc.neg.length },
  },
  held_speed_zig600_by_reported_hypothesis: Object.fromEntries(
    Object.entries(speedByHyp).map(([h, v]) => [
      h,
      {
        n: v.length,
        abs_median_kt: q(abs(v), 0.5),
        signed_median_kt: q(v, 0.5),
        slow: share(v.map((x) => x < 0)),
      },
    ]),
  ),
  held: sets.map((set, i) => ({
    estimator: set.estimator,
    speed_zig600: {
      n: held[i].speed.length,
      abs_median_kt: q(abs(held[i].speed), 0.5),
      signed_median_kt: q(held[i].speed, 0.5),
      slow: share(held[i].speed.map((x) => x < 0)),
    },
    course_abs_median_deg_by_min: Object.fromEntries(
      Object.entries(held[i].byMin).map(([k, v]) => [k, q(v, 0.5)]),
    ),
  })),
};
console.log(JSON.stringify(out, null, 2));
