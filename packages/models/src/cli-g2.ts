import { parseArgs } from "node:util";
import { isMain, UsageError } from "@tma/data";
import { requireCleanTree } from "@tma/eval";
import { runAsyncCli } from "./cli-run.js";
import { type G2Split, runG2 } from "./g2.js";

/** Exit code for a gate result other than pass (contracts/cli.md, PR #21). */
const EXIT_GATE_FAILED = 3;

const USAGE =
  "usage: tma-g2 --data <dir> --models <dir> --experiment <experiments/id> [--split test|validation] [--compare-models <dir>] [--decision <decision.json>] [--plan <plan.json>] [--rescore-of <experiments/id>] [--reuse-predictions <reuse.json>] [--skip-heldout] [--allow-dirty]";

export async function main(argv: string[]): Promise<unknown> {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      data: { type: "string" },
      models: { type: "string" },
      experiment: { type: "string" },
      split: { type: "string", default: "test" },
      "compare-models": { type: "string" },
      decision: { type: "string" },
      plan: { type: "string" },
      "rescore-of": { type: "string" },
      "reuse-predictions": { type: "string" },
      "skip-heldout": { type: "boolean", default: false },
      "allow-dirty": { type: "boolean", default: false },
    },
  });
  if (!values.data || !values.models || !values.experiment) throw new UsageError(USAGE);
  if (values.split !== "test" && values.split !== "validation") {
    throw new UsageError(`bad --split "${values.split}": expected test or validation`);
  }
  const split: G2Split = values.split;
  requireCleanTree(values["allow-dirty"]);
  const verdict = await runG2({
    data: values.data,
    models: values.models,
    experiment: values.experiment,
    split,
    ...(values["compare-models"] === undefined ? {} : { compareModels: values["compare-models"] }),
    ...(values.decision === undefined ? {} : { decision: values.decision }),
    ...(values.plan === undefined ? {} : { plan: values.plan }),
    ...(values["rescore-of"] === undefined ? {} : { rescoreOf: values["rescore-of"] }),
    ...(values["reuse-predictions"] === undefined
      ? {}
      : { reusePredictions: values["reuse-predictions"] }),
    ...(values["skip-heldout"] ? { heldout: false } : {}),
    ...(values["allow-dirty"] ? { allowDirty: true } : {}),
    commandLine: ["tma-g2", ...argv].join(" "),
  });
  if (verdict.result !== "pass") process.exitCode = EXIT_GATE_FAILED;
  return {
    experiment: values.experiment,
    split,
    gate: verdict.gate,
    result: verdict.result,
    decided_by: verdict.decided_by,
    checks: verdict.checks.map((c) => `${c.name}: ${c.result}`),
  };
}

if (isMain(import.meta.url)) runAsyncCli(main, process.argv.slice(2));
