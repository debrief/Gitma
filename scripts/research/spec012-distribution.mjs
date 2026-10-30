// Spec 012 FR-002 / SRD Annex C §C.2: the realised distribution of a generator-0.5.0 dataset, as
// G0 must report it (counts against the declared weights, speed changes, window lengths by mix,
// coverage and settled share at the G5 gate times), plus every split's content digest.
//   node scripts/research/spec012-distribution.mjs <data dir> > distribution.json
// Settled (Annex C §C.5 as pinned 2026-10-30): at row k no manoeuvre is in progress
// (start_index ≤ k < end_index) and either none has started (every start_index > k) or the most
// recent one ended at least 5 min before (k − end_index) · dt ≥ 300 s.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readDataset } from "../../packages/data/dist/index.js";
import { contentDigest } from "../train-plan.mjs";

const dir = process.argv[2];
const GATE_MIN = [5, 10, 15, 20];
const SETTLE_S = 300;
const q = (v, p) =>
  v.length ? [...v].sort((a, b) => a - b)[Math.floor(p * (v.length - 1))] : null;

export function settled(m, k) {
  const spans = m.manoeuvres ?? [];
  if (spans.some((x) => x.start_index <= k && k < x.end_index)) return false;
  const ended = spans.filter((x) => x.end_index <= k).map((x) => x.end_index);
  if (ended.length === 0) return true;
  return (k - Math.max(...ended)) * m.parameters.dt_s >= SETTLE_S;
}

const out = { splits: {} };
for (const split of ["train", "validation", "test", "heldout"]) {
  const path = join(dir, `${split}.f32pack`);
  if (!existsSync(path)) continue;
  const ds = readDataset(path);
  const ranges = ds.header.parameter_ranges;
  const weights = ranges.target_course_change_count_weights ?? [];
  const counts = weights.map(() => 0);
  const mixes = {};
  let n = 0;
  let speed = 0;
  const cover = Object.fromEntries(GATE_MIN.map((t) => [t, 0]));
  const settledRows = Object.fromEntries(GATE_MIN.map((t) => [t, [0, 0]]));
  const signBands = { "below 9 kt": [0, 0], "9–14 kt": [0, 0], "above 14 kt": [0, 0] };
  const angles = [];
  const rates = [];
  for (const s of ds.scenarios()) {
    const m = s.metadata;
    const plan = m.parameters.target_manoeuvres ?? [];
    const turns = plan.filter((x) => x.kind === "course");
    const sp = plan.find((x) => x.kind === "speed");
    n++;
    counts[turns.length] = (counts[turns.length] ?? 0) + 1;
    if (sp) {
      speed++;
      // The speed at the start of the change.
      const v0 =
        ((s.target.states[(m.manoeuvres?.find((x) => x.kind === "speed")?.start_index ?? 1) - 1]
          ?.speed_mps ?? 0) *
          3600) /
        1852;
      const band = v0 < 9 ? "below 9 kt" : v0 <= 14 ? "9–14 kt" : "above 14 kt";
      signBands[band][sp.change > 0 ? 0 : 1]++;
    }
    for (const t of turns) {
      angles.push((Math.abs(t.change) * 180) / Math.PI);
      rates.push((t.rate * 180) / Math.PI);
    }
    const key = `${turns.length}${sp ? "+s" : ""}`;
    const mx = (mixes[key] ??= { n: 0, window_min: [], zig_min: [], cover20: 0 });
    mx.n++;
    mx.window_min.push((m.samples * m.parameters.dt_s) / 60);
    mx.zig_min.push((m.zig_index * m.parameters.dt_s) / 60);
    for (const t of GATE_MIN) {
      const k = m.zig_index + Math.round((t * 60) / m.parameters.dt_s);
      if (k >= m.samples) continue;
      cover[t]++;
      settledRows[t][1]++;
      if (settled(m, k)) settledRows[t][0]++;
      if (t === 20) mx.cover20++;
    }
  }
  const chi2 = weights.reduce((acc, w, k) => acc + (counts[k] - w * n) ** 2 / (w * n), 0);
  const fSpeed = ranges.target_speed_change_fraction ?? 0;
  const totalRows = Object.values(settledRows).reduce((a, [, b]) => a + b, 0);
  const totalSettled = Object.values(settledRows).reduce((a, [b]) => a + b, 0);
  out.splits[split] = {
    content_digest: contentDigest(path),
    scenarios: n,
    course_change_counts: counts.map((c, k) => ({ count: k, share: c / n, declared: weights[k] })),
    chi2: { value: chi2, df: weights.length - 1, note: "5% critical value 7.81 for df 3" },
    speed_change_share: {
      value: speed / n,
      declared: fSpeed,
      z: (speed / n - fSpeed) / Math.sqrt((fSpeed * (1 - fSpeed)) / n),
    },
    coverage: Object.fromEntries(GATE_MIN.map((t) => [`zig+${t}min`, cover[t] / n])),
    settled_share: {
      ...Object.fromEntries(
        GATE_MIN.map((t) => [`zig+${t}min`, settledRows[t][0] / settledRows[t][1]]),
      ),
      all_rows: totalSettled / totalRows,
    },
    speed_change_sign_by_start_speed: Object.fromEntries(
      Object.entries(signBands).map(([b, [up, down]]) => [
        b,
        { n: up + down, increase_share: up + down ? up / (up + down) : null },
      ]),
    ),
    turn_angle_deg: { mean: angles.reduce((a, b) => a + b, 0) / angles.length, uniform_mean: 75 },
    turn_rate_deg_s: { mean: rates.reduce((a, b) => a + b, 0) / rates.length, uniform_mean: 1.75 },
    by_mix: Object.fromEntries(
      Object.entries(mixes)
        .sort()
        .map(([k, v]) => [
          k,
          {
            share: v.n / n,
            window_min_median: q(v.window_min, 0.5),
            window_min_p10: q(v.window_min, 0.1),
            zig_min_median: q(v.zig_min, 0.5),
            coverage_zig20: v.cover20 / v.n,
          },
        ]),
    ),
  };
}
console.log(JSON.stringify(out, null, 2));
