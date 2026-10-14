import { parseArgs } from "node:util";
import { isMain, UsageError } from "@tma/data";
import { requireCleanTree } from "@tma/eval";
import { runAsyncCli } from "./cli-run.js";
import { runScan } from "./scan.js";

const USAGE =
  "usage: tma-scan --data <dir> --models <dir> --experiment <experiments/id> [--allow-dirty]   (validation split only; reported, never gated)";

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
  if (!values.data || !values.models || !values.experiment) throw new UsageError(USAGE);
  requireCleanTree(values["allow-dirty"]);
  const rows = await runScan({
    data: values.data,
    models: values.models,
    experiment: values.experiment,
    commandLine: ["tma-scan", ...argv].join(" "),
  });
  return { experiment: values.experiment, split: "validation", rows };
}

if (isMain(import.meta.url)) runAsyncCli(main, process.argv.slice(2));
