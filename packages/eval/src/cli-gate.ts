import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { GateVerdict } from "@tma/types";
import { isMain, readDataset, runCli, UsageError } from "@tma/data";
import { MetricsRecord } from "@tma/types";
import { z } from "zod";
import { checkNaiveReproducible, checkNoiseFreeRecovery, g0Verdict } from "./gate.js";
import { writeVerdict } from "./experiment.js";
import { loadPredictionSet } from "./load.js";

export const EXIT_GATE_FAILED = 3;

const loadMetrics = (path: string): MetricsRecord[] =>
  z.array(MetricsRecord).parse(JSON.parse(readFileSync(path, "utf8")));

export function main(argv: string[]): GateVerdict {
  const [gate, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    strict: true,
    options: {
      experiment: { type: "string" },
      truth: { type: "string" },
      "noise-free-pred": { type: "string" },
      "naive-a": { type: "string" },
      "naive-b": { type: "string" },
    },
  });
  const { experiment, truth } = values;
  const pred = values["noise-free-pred"];
  const a = values["naive-a"];
  const b = values["naive-b"];
  if (gate !== "g0" || !experiment || !truth || !pred || !a || !b) {
    throw new UsageError(
      "usage: tma-gate g0 --experiment <dir> --truth <noise-free split> --noise-free-pred <classical.ndjson> --naive-a <metrics.json> --naive-b <metrics.json>",
    );
  }
  const ds = readDataset(truth);
  const classical = loadPredictionSet(pred, truth);
  const verdict = g0Verdict([
    checkNoiseFreeRecovery(ds.header, ds.scenarios(), classical.byIndex),
    checkNaiveReproducible(loadMetrics(a), loadMetrics(b)),
  ]);
  writeVerdict(experiment, verdict);
  return verdict;
}

if (isMain(import.meta.url)) {
  let verdict: GateVerdict | undefined;
  const code = runCli((argv) => (verdict = main(argv)), process.argv.slice(2));
  process.exitCode = code === 0 && verdict?.result === "fail" ? EXIT_GATE_FAILED : code;
}
