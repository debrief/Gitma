// Spec 025 (reported after the grid): the share of rows each composite variant takes from least
// squares (the grid script compared re-parsed rows by identity and reported 0), and the composite,
// fused-tracker and least-squares medians on straight-leg, after-manoeuvre and all G5 rows.
//   node scripts/research/spec025-slices.mjs
const R = "/home/user/Gitma/";
const { compositePredict } = await import(R + "packages/classical/dist/index.js");
const { errorOf, g5Rows, rowAt } = await import(R + "packages/eval/dist/gate-g5.js");
const { straightRow } = await import(R + "packages/eval/dist/gate-g9.js");
const { openPredictionSet, scenarioSource } = await import(
  R + "packages/eval/dist/prediction-file.js"
);
const D = R + "data/p11val/real/";
const truth = D + "validation.f32pack";
const lsq = openPredictionSet(D + "pred/lsq.ndjson", truth),
  fused = openPredictionSet(D + "pred/fused-t2.ndjson", truth);
const sc = Array.from(scenarioSource(truth));
const rows = g5Rows(sc);
const g5s = [...new Set(rows.map((r) => r.s))];
const med = (xs) => {
  const b = Float64Array.from(xs).sort();
  return b[Math.floor((b.length - 1) / 2)];
};
const out = {};
for (const [W, c] of [
  [6, 8],
  [12, 6],
  [30, 4],
  [60, 3],
  [60, 12],
]) {
  const by = new Map();
  let fromL = 0,
    tot = 0,
    g5L = 0,
    g5T = 0;
  const lsqRow = new Map();
  for (const s of g5s) {
    const id = s.metadata.index;
    const pc = lsq.byIndex.get(id);
    const p = compositePredict(s, pc, fused.byIndex.get(id), { window: W, threshold: c });
    p.rows.forEach((r, i) => {
      tot++;
      if (r === pc.rows[i]) fromL++;
    });
    by.set(id, p);
    lsqRow.set(id, new Set(p.rows.filter((r, i) => r === pc.rows[i]).map((r) => r.timestamp_s)));
  }
  const set = { label: "c", estimator: "c", byIndex: by };
  for (const r of rows) {
    g5T++;
    const ts = r.k * r.s.metadata.parameters.dt_s;
    if (lsqRow.get(r.s.metadata.index).has(ts)) g5L++;
  }
  const sl = {
    straight: rows.filter(straightRow),
    after: rows.filter((r) => (r.s.metadata.manoeuvres ?? []).some((m) => m.end_index <= r.k)),
    all: rows,
  };
  const res = { share_all_rows: fromL / tot, share_g5_rows: g5L / g5T };
  for (const [n, rs] of Object.entries(sl))
    res[n] = Object.fromEntries(
      ["range_rel", "course_deg", "speed_kt"].map((m) => [
        m,
        [
          med(rs.map((r) => errorOf(r.s, rowAt(set, r.s, r.k), m))),
          med(rs.map((r) => errorOf(r.s, rowAt(fused, r.s, r.k), m))),
          med(rs.map((r) => errorOf(r.s, rowAt(lsq, r.s, r.k), m))),
        ].map((x) => +x.toFixed(4)),
      ]),
    );
  out[`W${W}-c${c}`] = res;
  console.log(`W${W}-c${c}`, JSON.stringify(res));
}
(await import("node:fs")).writeFileSync(
  R + "experiments/20261115-p12-val/slices.json",
  JSON.stringify(
    {
      note: "composite / fused / lsq medians per slice: [composite, fused, lsq]; share = fraction of rows taken from least squares",
      variants: out,
    },
    null,
    2,
  ) + "\n",
);
