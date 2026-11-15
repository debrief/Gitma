import { parseArgs } from "node:util";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import {
  canonicalJson,
  isMain,
  openAtomic,
  readDataset,
  runCli,
  UsageError,
  writeAll,
} from "@tma/data";
import type { PredictionMode } from "@tma/types";
import { CLASSICAL, classicalPredict } from "./estimate.js";
import type { SolveOptions } from "./lsq.js";
import { predictionHeader } from "./predictions.js";

const USAGE =
  "usage: tma-solve --in <test.f32pack> --out <pred.ndjson> [--per-timestep] [--max-iter n] [--grid-every n] [--workers n]";

interface Job {
  in: string;
  mode: PredictionMode;
  opts: SolveOptions;
}

function parse(argv: string[]): Job & { out: string; workers: number } {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      in: { type: "string" },
      out: { type: "string" },
      "per-timestep": { type: "boolean", default: false },
      "max-iter": { type: "string", default: "50" },
      "grid-every": { type: "string", default: "6" },
      workers: { type: "string", default: "1" },
    },
  });
  if (values.in === undefined || values.out === undefined) throw new UsageError(USAGE);
  const maxIterations = Number(values["max-iter"]);
  if (!Number.isInteger(maxIterations) || maxIterations < 1) throw new UsageError("bad --max-iter");
  const gridEvery = Number(values["grid-every"]);
  if (!Number.isInteger(gridEvery) || gridEvery < 0) throw new UsageError("bad --grid-every");
  const workers = Number(values.workers);
  if (!Number.isInteger(workers) || workers < 1) throw new UsageError("bad --workers");
  return {
    in: values.in,
    out: values.out,
    mode: values["per-timestep"] ? "per_timestep" : "final",
    opts: { maxIterations, gridEvery },
    workers,
  };
}

/** One output line per scenario, in file order; scenarios at positions ≡ part (mod parts). */
function* solveLines(
  job: Job,
  part = 0,
  parts = 1,
): Generator<{ pos: number; line: string; nonConverged: boolean }> {
  let pos = 0;
  for (const s of readDataset(job.in).scenarios()) {
    if (pos % parts === part) {
      const p = classicalPredict(s, job.mode, job.opts);
      yield { pos, line: `${canonicalJson(p)}\n`, nonConverged: p.rows.some((r) => !r.converged) };
    }
    pos++;
  }
}

/**
 * The prediction file is written as it is produced (a per-timestep file of a large split exceeds
 * V8's string limit when joined), atomically: all or nothing. With --workers n, scenarios are
 * solved in n threads and written in file order, so the output is byte-identical to one thread's.
 */
export function main(argv: string[]): unknown {
  const job = parse(argv);
  if (job.workers !== 1) throw new UsageError("--workers > 1 needs the command line (async)");
  const t0 = performance.now();
  const f = openAtomic(job.out);
  try {
    writeAll(
      f.fd,
      Buffer.from(`${canonicalJson(predictionHeader(CLASSICAL, job.mode, job.in))}\n`),
    );
    let scenarios = 0;
    let nonConverged = 0;
    for (const r of solveLines(job)) {
      writeAll(f.fd, Buffer.from(r.line, "utf8"));
      scenarios++;
      if (r.nonConverged) nonConverged++;
    }
    f.commit();
    return summary(job, scenarios, nonConverged, t0);
  } catch (e) {
    f.abort();
    throw e;
  }
}

const summary = (
  job: Job & { out: string },
  scenarios: number,
  nonConverged: number,
  t0: number,
) => ({
  out: job.out,
  mode: job.mode,
  scenarios,
  non_converged: nonConverged,
  seconds: (performance.now() - t0) / 1000,
});

/** As `main`, with the scenarios split across `--workers` threads. */
export async function mainParallel(argv: string[]): Promise<unknown> {
  const job = parse(argv);
  if (job.workers === 1) return main(argv);
  const t0 = performance.now();
  const f = openAtomic(job.out);
  const pending = new Map<number, string>();
  let next = 0;
  let scenarios = 0;
  let nonConverged = 0;
  const drain = (): void => {
    for (let line = pending.get(next); line !== undefined; line = pending.get(next)) {
      writeAll(f.fd, Buffer.from(line, "utf8"));
      pending.delete(next);
      next++;
    }
  };
  try {
    writeAll(
      f.fd,
      Buffer.from(`${canonicalJson(predictionHeader(CLASSICAL, job.mode, job.in))}\n`),
    );
    const runs = Array.from({ length: job.workers }, (_, part) => {
      const w = new Worker(new URL(import.meta.url), {
        workerData: {
          job: { in: job.in, mode: job.mode, opts: job.opts },
          part,
          parts: job.workers,
        },
      });
      return new Promise<void>((resolve, reject) => {
        w.on("message", (m: { pos: number; line: string; nonConverged: boolean }) => {
          pending.set(m.pos, m.line);
          scenarios++;
          if (m.nonConverged) nonConverged++;
          drain();
        });
        w.on("error", reject);
        w.on("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`solver worker ${String(part)} exited with code ${String(code)}`));
        });
      });
    });
    await Promise.all(runs);
    drain();
    if (pending.size !== 0) throw new Error(`${String(pending.size)} scenarios left unwritten`);
    f.commit();
    return summary(job, scenarios, nonConverged, t0);
  } catch (e) {
    f.abort();
    throw e;
  }
}

if (!isMainThread && parentPort !== null) {
  const { job, part, parts } = workerData as { job: Job; part: number; parts: number };
  for (const r of solveLines(job, part, parts)) parentPort.postMessage(r);
} else if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes("--workers")) {
    mainParallel(argv).then(
      (s) => process.stdout.write(`${JSON.stringify(s)}\n`),
      (e: unknown) => {
        process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
        process.exitCode = e instanceof UsageError ? 1 : 2;
      },
    );
  } else process.exitCode = runCli(main, argv);
}
