import { UsageError } from "@tma/data";

/** Async CLI wrapper (contracts/cli.md): JSON summary on stdout; exit 1 usage, 2 error. */
export function runAsyncCli(main: (argv: string[]) => Promise<unknown>, argv: string[]): void {
  main(argv).then(
    (summary) => {
      process.stdout.write(`${JSON.stringify(summary)}\n`);
    },
    (e: unknown) => {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      process.exitCode = e instanceof UsageError ? 1 : 2;
    },
  );
}
