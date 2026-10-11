import { parseArgs } from "node:util";
import { isMain, runCli, UsageError } from "./cli.js";
import { convertDataset, sameDataset } from "./dataset.js";

export function main(argv: string[]): unknown {
  const { values, positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      in: { type: "string" },
      out: { type: "string" },
      check: { type: "boolean", default: false },
    },
  });
  if (values.check) {
    const [a, b] = positionals;
    if (a === undefined || b === undefined) throw new UsageError("usage: tma-convert --check <a> <b>");
    const r = sameDataset(a, b);
    if (!r.same) throw new Error(`datasets differ: ${r.detail}`);
    return { same: true, detail: r.detail };
  }
  if (values.in === undefined || values.out === undefined) {
    throw new UsageError("usage: tma-convert --in <file> --out <file>");
  }
  return { in: values.in, out: values.out, scenarios: convertDataset(values.in, values.out) };
}

if (isMain(import.meta.url)) process.exitCode = runCli(main, process.argv.slice(2));
