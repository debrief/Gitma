// Spec 013 research (owner decision 30: a hybrid of the frozen IMM reference and T2). Scores
// candidate switching rules on the G5 rows of one split, from existing prediction files, as
// G5 would: median range, course and speed error, overall and on settled rows, each as a ratio
// to the IMM. Every rule is causal: it reads only the two trackers' outputs at the same row.
//
//   pnpm build
//   node scripts/research/spec013-hybrid.mjs <truth.f32pack> <imm.ndjson> <t2.ndjson> [out.json]
import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { g5Rows, scenarioSource } from "../../packages/eval/dist/index.js";

const [truthPath, immPath, t2Path, outPath] = process.argv.slice(2);
if (t2Path === undefined) {
  console.error("usage: spec013-hybrid.mjs <truth.f32pack> <imm.ndjson> <t2.ndjson> [out.json]");
  process.exit(2);
}

const rows = g5Rows(scenarioSource(truthPath));
const byScenario = new Map();
for (const r of rows) {
  const list = byScenario.get(r.s.metadata.index) ?? [];
  list.push(r);
  byScenario.set(r.s.metadata.index, list);
}

/** The prediction row at each G5 row, keyed "scenario:k". */
async function load(path) {
  const out = new Map();
  for await (const line of createInterface({ input: createReadStream(path) })) {
    if (!line.includes('"prediction"')) continue;
    const p = JSON.parse(line);
    const list = byScenario.get(p.scenario_index);
    if (list === undefined) continue;
    for (const r of list) {
      const dt = r.s.metadata.parameters.dt_s;
      const row = p.rows.find((x) => Math.round(x.timestamp_s / dt) === r.k);
      if (row !== undefined) out.set(`${p.scenario_index}:${r.k}`, row);
    }
  }
  return out;
}
const imm = await load(immPath);
const t2 = await load(t2Path);

const deg = (a) => (a * 180) / Math.PI;
const wrap = (a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
const KT = 1.943844;

/** Candidate rules: (immRow, t2Row) → { range source, velocity source }. */
const rules = {
  imm: () => ["imm", "imm"],
  t2: () => ["t2", "t2"],
  "range-t2": () => ["t2", "imm"],
};
for (const c of [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 90]) {
  rules[`switch-course-${c}`] = (a, b) => {
    const s = deg(wrap(a.course_rad - b.course_rad)) > c ? "t2" : "imm";
    return [s, s];
  };
  rules[`range-t2-vel-course-${c}`] = (a, b) => [
    "t2",
    deg(wrap(a.course_rad - b.course_rad)) > c ? "t2" : "imm",
  ];
}
for (const sd of [0.5, 0.75, 1, 1.5, 2]) {
  rules[`range-t2-vel-sd-${sd}`] = (_a, b) => [
    "t2",
    Math.hypot(b.vx_sd_mps ?? 0, b.vy_sd_mps ?? 0) > sd ? "t2" : "imm",
  ];
}

const errs = {};
for (const name of Object.keys(rules))
  errs[name] = { all: [[], [], []], settled: [[], [], []], t2share: 0 };
let n = 0;
for (const r of rows) {
  const key = `${r.s.metadata.index}:${r.k}`;
  const a = imm.get(key);
  const b = t2.get(key);
  if (a === undefined || b === undefined || !a.converged || !b.converged) continue;
  n++;
  const o = r.s.ownship.states[r.k];
  const t = r.s.target.states[r.k];
  const range = Math.hypot(t.x_m - o.x_m, t.y_m - o.y_m);
  for (const [name, rule] of Object.entries(rules)) {
    const [rs, vs] = rule(a, b);
    const R = rs === "t2" ? b : a;
    const V = vs === "t2" ? b : a;
    const e = [
      Math.abs(R.range_m - range) / range,
      deg(wrap(V.course_rad - t.course_rad)),
      Math.abs(V.speed_mps - t.speed_mps) * KT,
    ];
    for (const set of r.settled ? ["all", "settled"] : ["all"])
      e.forEach((v, i) => errs[name][set][i].push(v));
    if (vs === "t2") errs[name].t2share++;
  }
}

const median = (xs) => {
  const s = Float64Array.from(xs).sort();
  return s[Math.floor(s.length / 2)];
};
const out = { rows: n, rules: {} };
const base = errs.imm;
for (const [name, e] of Object.entries(errs)) {
  const ratio = (set, i) => +(median(e[set][i]) / median(base[set][i])).toFixed(3);
  out.rules[name] = {
    velocity_from_t2: +(e.t2share / n).toFixed(3),
    overall: { range: ratio("all", 0), course: ratio("all", 1), speed: ratio("all", 2) },
    settled: {
      range: ratio("settled", 0),
      course: ratio("settled", 1),
      speed: ratio("settled", 2),
    },
  };
  // Smallest relative margin over the five gated checks (limits 1, 1, 1.1, 1.1, 1.1): the
  // declared criterion for choosing θ (spec 013 R2).
  const r = out.rules[name];
  r.min_margin = +Math.min(
    1 - r.overall.range,
    1 - r.overall.course,
    (1.1 - r.settled.range) / 1.1,
    (1.1 - r.settled.course) / 1.1,
    (1.1 - r.settled.speed) / 1.1,
  ).toFixed(3);
}
for (const [name, v] of Object.entries(out.rules))
  console.log(
    `${name.padEnd(26)} margin ${String(v.min_margin).padEnd(6)} T2vel ${String(v.velocity_from_t2).padEnd(6)} overall R ${v.overall.range} C ${v.overall.course} S ${v.overall.speed} | settled R ${v.settled.range} C ${v.settled.course} S ${v.settled.speed}`,
  );
if (outPath !== undefined) writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
