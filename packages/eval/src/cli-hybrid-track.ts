// tma-hybrid-track (spec 013): the tracker hybrid of a tracker's and a network's per-timestep
// predictions (trackerHybrid in @tma/classical), written as a prediction file. A pipeline stage of
// its own; the threshold is part of the estimator name, so a gate binds it with the decision.
import { parseArgs } from "node:util";
import {
  fileDigest,
  TRACKER_SWITCH_COURSE_DEG,
  trackerHybrid,
  trackerHybridName,
} from "@tma/classical";
import { isMain, runCli, UsageError } from "@tma/data";
import { openPredictionSet, openPredictionWriter, scenarioSource } from "./prediction-file.js";

const USAGE =
  "usage: tma-hybrid-track --truth <split.f32pack> --tracker <imm.ndjson> --network <t2.ndjson> --out <hybrid.ndjson> [--course-deg 45]";

export function main(argv: string[]): unknown {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      truth: { type: "string" },
      tracker: { type: "string" },
      network: { type: "string" },
      out: { type: "string" },
      "course-deg": { type: "string" },
    },
  });
  const { truth, tracker, network, out } = values;
  if (!truth || !tracker || !network || !out) throw new UsageError(USAGE);
  const deg = Number(values["course-deg"] ?? TRACKER_SWITCH_COURSE_DEG);
  if (!Number.isFinite(deg) || deg <= 0 || deg >= 180)
    throw new UsageError(`--course-deg must be in (0, 180), got ${String(values["course-deg"])}`);
  const t = openPredictionSet(tracker, truth);
  const n = openPredictionSet(network, truth);
  const name = trackerHybridName(n.estimator, t.estimator, deg);
  // The inputs' digests let a gate tie the hybrid to the files it was built from (schema 0.17.0).
  const w = openPredictionWriter(out, name, "per_timestep", truth, {
    inputs: [
      { estimator: t.estimator, sha256: fileDigest(tracker) },
      { estimator: n.estimator, sha256: fileDigest(network) },
    ],
  });
  let velocityFromNetwork = 0;
  let rows = 0;
  try {
    for (const s of scenarioSource(truth)) {
      const id = s.metadata.index;
      const pt = t.byIndex.get(id);
      const pn = n.byIndex.get(id);
      if (pt === undefined || pn === undefined)
        throw new Error(
          `scenario ${String(id)}: missing from ${pt === undefined ? tracker : network}`,
        );
      const h = trackerHybrid(pt, pn, deg);
      h.rows.forEach((r, i) => {
        rows++;
        const n = pn.rows[i];
        if (n !== undefined && r.course_rad === n.course_rad && r.speed_mps === n.speed_mps)
          velocityFromNetwork++;
      });
      w.write(h);
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
    velocity_from_network: velocityFromNetwork,
  };
}

if (isMain(import.meta.url)) process.exitCode = runCli(main, process.argv.slice(2));
