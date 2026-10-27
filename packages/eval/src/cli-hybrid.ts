// tma-hybrid (spec 009): the hybrid of classical and a network's per-timestep predictions
// (hybridSwitch in @tma/classical), written as a prediction file. A pipeline stage of its own.
import { parseArgs } from "node:util";
import { hybridName, hybridSwitch } from "@tma/classical";
import { isMain, runCli, UsageError } from "@tma/data";
import { openPredictionSet, openPredictionWriter, scenarioSource } from "./prediction-file.js";

const USAGE =
  "usage: tma-hybrid --truth <test.f32pack> --classical <classical.ndjson> --network <network.ndjson> --out <hybrid.ndjson>";

export function main(argv: string[]): unknown {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      truth: { type: "string" },
      classical: { type: "string" },
      network: { type: "string" },
      out: { type: "string" },
    },
  });
  const { truth, classical, network, out } = values;
  if (!truth || !classical || !network || !out) throw new UsageError(USAGE);
  const c = openPredictionSet(classical, truth);
  const n = openPredictionSet(network, truth);
  if (c.estimator !== "classical") throw new UsageError(`${classical}: not classical predictions`);
  const w = openPredictionWriter(out, hybridName(n.estimator), "per_timestep", truth);
  let switched = 0;
  let rows = 0;
  try {
    for (const s of scenarioSource(truth)) {
      const id = s.metadata.index;
      const pc = c.byIndex.get(id);
      const pn = n.byIndex.get(id);
      if (pc === undefined || pn === undefined)
        throw new Error(
          `scenario ${String(id)}: missing from ${pc === undefined ? classical : network}`,
        );
      const h = hybridSwitch(pc, pn);
      h.rows.forEach((r, i) => {
        rows++;
        if (r !== pc.rows[i]) switched++;
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
    estimator: hybridName(n.estimator),
    scenarios: w.count,
    rows,
    switched_rows: switched,
  };
}

if (isMain(import.meta.url)) process.exitCode = runCli(main, process.argv.slice(2));
