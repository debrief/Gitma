import { parseArgs } from "node:util";
import { isMain, UsageError } from "@tma/data";
import { requireCleanTree } from "@tma/eval";
import { runAsyncCli } from "./cli-run.js";
import { runG1 } from "./g1.js";

/** Exit code for a failed gate (contracts/cli.md). */
const EXIT_GATE_FAILED = 3;

export async function main(argv: string[]): Promise<unknown> {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      data: { type: "string" },
      models: { type: "string" },
      experiment: { type: "string" },
      "allow-dirty": { type: "boolean", default: false },
    },
  });
  if (!values.data || !values.models || !values.experiment) {
    throw new UsageError(
      "usage: tma-g1 --data <dir> --models <dir> --experiment <experiments/id> [--allow-dirty]",
    );
  }
  requireCleanTree(values["allow-dirty"]);
  const verdict = await runG1({
    data: values.data,
    models: values.models,
    experiment: values.experiment,
    commandLine: ["tma-g1", ...argv].join(" "),
  });
  // Fail or inconclusive: the gate is not passed.
  if (verdict.result !== "pass") process.exitCode = EXIT_GATE_FAILED;
  return {
    experiment: values.experiment,
    gate: verdict.gate,
    result: verdict.result,
    checks: verdict.checks.map((c) => `${c.name}: ${c.result}`),
  };
}

if (isMain(import.meta.url)) runAsyncCli(main, process.argv.slice(2));
