// tma-composite (spec 025): the composite of a per-timestep least-squares file and a fused-tracker
// file (compositePredict in @tma/classical), written as a prediction file. A pipeline stage of its
// own; the fit check's window and threshold are part of the estimator name, so a gate binds them
// with the decision, and the inputs' digests bind the files it was built from.
import { parseArgs } from "node:util";
import {
  CLASSICAL,
  type CompositeParams,
  compositeName,
  compositePredict,
  fileDigest,
} from "@tma/classical";
import { isMain, runCli, UsageError } from "@tma/data";
import { openPredictionSet, openPredictionWriter, scenarioSource } from "./prediction-file.js";

const USAGE =
  "usage: tma-composite --truth <split.f32pack> --classical <lsq.ndjson> --fused <fused.ndjson> --out <composite.ndjson> --window <samples> --threshold <mean r²/σ²> [--leg <samples> --prior-sd <log-range sd>] (re-armed, §D.7)";

export function main(argv: string[]): unknown {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      truth: { type: "string" },
      classical: { type: "string" },
      fused: { type: "string" },
      out: { type: "string" },
      window: { type: "string" },
      threshold: { type: "string" },
      leg: { type: "string" },
      "prior-sd": { type: "string" },
    },
  });
  const { truth, classical, fused, out } = values;
  if (!truth || !classical || !fused || !out || !values.window || !values.threshold)
    throw new UsageError(USAGE);
  const window = Number(values.window);
  const threshold = Number(values.threshold);
  if (!Number.isInteger(window) || window < 1)
    throw new UsageError("--window must be an integer ≥ 1");
  if (!Number.isFinite(threshold) || threshold <= 0)
    throw new UsageError("--threshold must be > 0");
  const c = openPredictionSet(classical, truth);
  const f = openPredictionSet(fused, truth);
  if (c.estimator !== CLASSICAL)
    throw new UsageError(`${classical}: estimator ${c.estimator}, not ${CLASSICAL}`);
  if (!f.estimator.startsWith("fused-"))
    throw new UsageError(`${fused}: estimator ${f.estimator} is not a fused tracker`);
  if ((values.leg === undefined) !== (values["prior-sd"] === undefined))
    throw new UsageError("--leg and --prior-sd are given together");
  const leg = values.leg === undefined ? undefined : Number(values.leg);
  const priorSd = values["prior-sd"] === undefined ? undefined : Number(values["prior-sd"]);
  if (leg !== undefined && (!Number.isInteger(leg) || leg < 1))
    throw new UsageError("--leg must be an integer ≥ 1");
  if (priorSd !== undefined && !(Number.isFinite(priorSd) && priorSd > 0))
    throw new UsageError("--prior-sd must be > 0");
  const p: CompositeParams =
    leg === undefined || priorSd === undefined
      ? { window, threshold }
      : { window, threshold, leg, priorSd };
  const name = compositeName(c.estimator, f.estimator, p);
  const w = openPredictionWriter(out, name, "per_timestep", truth, {
    inputs: [
      { estimator: c.estimator, sha256: fileDigest(classical) },
      { estimator: f.estimator, sha256: fileDigest(fused) },
    ],
  });
  let rows = 0;
  let fromClassical = 0;
  let switched = 0;
  try {
    for (const s of scenarioSource(truth)) {
      const id = s.metadata.index;
      const pc = c.byIndex.get(id);
      const pf = f.byIndex.get(id);
      if (pc === undefined || pf === undefined)
        throw new Error(
          `scenario ${String(id)}: missing from ${pc === undefined ? classical : fused}`,
        );
      const out = compositePredict(s, pc, pf, p);
      const fromLsq = out.rows.filter((r, i) => r === pc.rows[i]).length;
      rows += out.rows.length;
      fromClassical += fromLsq;
      if (fromLsq < out.rows.length) switched++;
      w.write(out);
    }
    w.commit();
  } catch (e) {
    w.abort();
    throw e;
  }
  return {
    out,
    estimator: name,
    scenarios: w.count,
    rows,
    rows_from_classical: fromClassical,
    scenarios_with_fused_rows: switched,
  };
}

if (isMain(import.meta.url)) process.exitCode = runCli(main, process.argv.slice(2));
