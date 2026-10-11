// Shared CLI conventions (contracts/cli.md): JSON summary on stdout, errors on stderr, exit codes.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RecordError } from "@tma/types";

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_VALIDATION = 2;

export class UsageError extends Error {}

/** Run a CLI main, mapping errors to exit codes. */
export function runCli(main: (argv: string[]) => unknown, argv: string[]): number {
  try {
    const summary = main(argv);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return EXIT_OK;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${message}\n`);
    const code = (e as { code?: unknown }).code;
    const parseError = typeof code === "string" && code.startsWith("ERR_PARSE_ARGS");
    if (e instanceof UsageError || parseError) return EXIT_USAGE;
    if (e instanceof RecordError) return EXIT_VALIDATION;
    return EXIT_VALIDATION;
  }
}

/** True when the module at `url` is the script node was started with. */
export function isMain(url: string): boolean {
  const script = process.argv[1];
  if (script === undefined) return false;
  return realpathSync(script) === realpathSync(fileURLToPath(url));
}
