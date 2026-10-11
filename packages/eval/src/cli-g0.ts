import { parseArgs } from "node:util";
import type { GateVerdict } from "@tma/types";
import { isMain, runCli, UsageError } from "@tma/data";
import { EXIT_GATE_FAILED } from "./cli-gate.js";
import { runG0 } from "./g0.js";

export function main(argv: string[]): GateVerdict {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: { data: { type: "string" }, experiment: { type: "string" } },
  });
  if (values.data === undefined || values.experiment === undefined) {
    throw new UsageError(
      "usage: tma-g0 --data <noise-free dataset dir> --experiment <experiments/id>",
    );
  }
  const r = runG0(values.data, values.experiment, ["tma-g0", ...argv].join(" "));
  return r.verdict;
}

if (isMain(import.meta.url)) {
  let verdict: GateVerdict | undefined;
  const code = runCli((argv) => (verdict = main(argv)), process.argv.slice(2));
  process.exitCode = code === 0 && verdict?.result === "fail" ? EXIT_GATE_FAILED : code;
}
