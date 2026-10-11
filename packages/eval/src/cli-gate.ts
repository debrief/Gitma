import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { GateVerdict } from "@tma/types";
import { isMain, readDataset, runCli, UsageError } from "@tma/data";
import { MetricsRecord } from "@tma/types";
import { z } from "zod";
import { join } from "node:path";
import { parseCurvesCsv } from "./csv.js";
import { checkNaiveReproducible, checkNoiseFreeRecovery, g0Verdict } from "./gate.js";
import { g1Checks, g1Verdict } from "./gate-g1.js";
import { writeVerdict } from "./experiment.js";
import { loadPredictionSet } from "./load.js";

export const EXIT_GATE_FAILED = 3;

export const loadMetrics = (path: string): MetricsRecord[] =>
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
      instantaneous: { type: "string" },
      "time-late": { type: "string" },
      "causal-control": { type: "string" },
      "mlp-control": { type: "string" },
      shuffled: { type: "string" },
    },
  });
  if (gate === "g1") return mainG1(values);
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

interface G1Args {
  experiment?: string | undefined;
  instantaneous?: string | undefined;
  "time-late"?: string | undefined;
  "causal-control"?: string | undefined;
  "mlp-control"?: string | undefined;
  shuffled?: string | undefined;
}

function mainG1(v: G1Args): GateVerdict {
  const { experiment, instantaneous } = v;
  const timeLate = v["time-late"];
  const causalControl = v["causal-control"];
  const mlpControl = v["mlp-control"];
  const { shuffled } = v;
  if (!experiment || !instantaneous || !timeLate || !causalControl || !mlpControl || !shuffled) {
    throw new UsageError(
      "usage: tma-gate g1 --experiment <dir> --instantaneous <id> --time-late <id> --causal-control <id> --mlp-control <id> --shuffled <id>",
    );
  }
  const metrics = loadMetrics(join(experiment, "metrics.json"));
  const curves = parseCurvesCsv(readFileSync(join(experiment, "curves.csv"), "utf8"));
  const verdict = g1Verdict(
    g1Checks(metrics, curves, {
      instantaneous,
      timeLate,
      causalControl,
      mlpControl,
      shuffled,
    }),
  );
  writeVerdict(experiment, verdict);
  return verdict;
}

if (isMain(import.meta.url)) {
  let verdict: GateVerdict | undefined;
  const code = runCli((argv) => (verdict = main(argv)), process.argv.slice(2));
  process.exitCode = code === 0 && verdict?.result === "fail" ? EXIT_GATE_FAILED : code;
}
