// Spec 026 (research, no gate): collects the severity sweep's per-severity baselines
// (spec019-baselines.mjs) and bounds (spec024-crb.mjs) into one table: for each severity and
// estimator, median range / course / speed error on all G5 rows, straight-leg rows (settled,
// before any manoeuvre) and settled rows after a manoeuvre; each estimator's range ratio to the
// -g1 IMM; and the Cramér–Rao bound's medians (exact on straight legs, a genie bound after).
//   node scripts/research/spec026-sweep.mjs <experiment dir> > sweep.json
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const SEV = ["x0", "x0.5", "x1", "x2"];
const SLICE = {
  all: "all G5 rows",
  straight: "settled, before any manoeuvre",
  "settled-after": "settled, after a manoeuvre",
};
const short = (e) =>
  e.startsWith("fused-")
    ? "fused"
    : e.startsWith("composite-")
      ? "composite"
      : e.startsWith("imm-")
        ? "imm"
        : e.startsWith("ekf-")
          ? "ekf"
          : e === "lstm-gaussian"
            ? "t2"
            : e === "classical"
              ? "lsq"
              : e;
const out = { severities: {} };
for (const x of SEV) {
  const b = JSON.parse(readFileSync(join(dir, `baselines-${x}.json`), "utf8"));
  const c = JSON.parse(readFileSync(join(dir, `crb-${x}.json`), "utf8"));
  const sev = { medians: {}, range_vs_imm: {}, bound: {} };
  for (const [k, rows] of Object.entries(SLICE)) {
    sev.medians[k] = {};
    for (const m of b.medians.filter((m) => m.rows === rows)) {
      const e = short(m.estimator);
      sev.medians[k][e] ??= {};
      sev.medians[k][e][m.metric] = m.median;
    }
    const imm = sev.medians[k].imm?.range_rel;
    sev.range_vs_imm[k] = Object.fromEntries(
      Object.entries(sev.medians[k]).map(([e, v]) => [e, v.range_rel / imm]),
    );
  }
  sev.bound.straight = c.slices["settled, before any manoeuvre (exact CV bound)"].bound_median;
  sev.bound.after_genie = c.slices["after a manoeuvre (genie bound)"].bound_median;
  sev.bound.all = c.slices.all.bound_median;
  out.severities[x] = sev;
}
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
