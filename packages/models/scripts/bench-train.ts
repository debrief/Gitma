// Training-step benchmark (research R15): LSTM and BiLSTM, padded or length-bucketed batches, with
// TensorFlow's default thread pools or a single thread. Each case runs in its own process because
// libtensorflow reads TF_NUM_INTRAOP_THREADS / TF_NUM_INTEROP_THREADS only when tfjs-node loads.
//
//   pnpm build
//   node packages/models/scripts/bench-train.ts --train <train.features.bin> --out <dir> [--steps 8] [--warmup 2]
//
// Writes <dir>/bench.json and <dir>/bench.md and prints the table. Timing only: nothing is saved.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const MODELS = { lstm: "instantaneous.json", bilstm: "time-late.json" } as const;
type ModelName = keyof typeof MODELS;
type Mode = "padded" | "bucketed";
const THREADS = ["default", "1"] as const;
const MODES: Mode[] = ["padded", "bucketed"];

interface Result {
  model: ModelName;
  mode: Mode;
  threads: string;
  steps: number;
  batch_size: number;
  mean_rows: number;
  /** Mean rows per full batch over the whole epoch (all batches, not only the timed ones). */
  epoch_mean_rows: number;
  ms_per_step: number;
  ms_per_window: number;
  tf_intraop_threads?: number;
  tf_interop_threads?: number;
}

const configsDir = fileURLToPath(new URL("../../../configs/iter1/", import.meta.url));

async function child(train: string, model: ModelName, mode: Mode, steps: number, warmup: number) {
  // Imported here, after the parent has set the thread environment for this process.
  const tf = await import("@tensorflow/tfjs-node");
  const { NI, openFeatures } = await import("@tma/features");
  const { parseRecord, TrainingConfig } = await import("@tma/types");
  const m = await import("@tma/models");
  const path = join(configsDir, MODELS[model]);
  const config = parseRecord(
    TrainingConfig,
    {
      ...(JSON.parse(readFileSync(path, "utf8")) as object),
      length_bucketing: mode === "bucketed",
    },
    path,
    "config",
  );
  const file = openFeatures(train);
  try {
    const n = file.count;
    if (n < (steps + warmup) * config.batch_size) {
      throw new Error(
        `need ${String((steps + warmup) * config.batch_size)} windows, have ${String(n)}`,
      );
    }
    const lengths = mode === "bucketed" ? m.windowLengths(file, n) : undefined;
    const batches = m
      .epochBatches(config, 0, n, lengths)
      .filter((b) => b.length === config.batch_size);
    const labels = m.labelMap(config, n);
    const net = m.buildModel(config);
    const optimizer = tf.train.adam(config.learning_rate);
    const loss = m.makeLoss(config);
    let ms = 0;
    let rows = 0;
    for (let i = 0; i < warmup + steps; i++) {
      const ks = batches[i];
      if (ks === undefined) throw new Error("not enough batches");
      const b = m.makeBatch(file, ks, config, labels, m.batchRows(config, ks, lengths));
      const t0 = performance.now();
      const x = tf.tensor3d(b.x, [b.size, b.rows, NI]);
      const y = tf.tensor3d(b.y, [b.size, b.rows, m.NY]);
      m.trainStep(net, optimizer, loss, x, y);
      x.dispose();
      y.dispose();
      const dt = performance.now() - t0;
      if (i >= warmup) {
        ms += dt;
        rows += b.rows;
      }
    }
    const result: Result = {
      model,
      mode,
      threads: process.env.TF_NUM_INTRAOP_THREADS ?? "default",
      steps,
      batch_size: config.batch_size,
      mean_rows: rows / steps,
      epoch_mean_rows:
        batches.reduce((s, ks) => s + m.batchRows(config, ks, lengths), 0) / batches.length,
      ms_per_step: ms / steps,
      ms_per_window: ms / steps / config.batch_size,
      ...m.threadSettings(),
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    file.close();
  }
}

function table(results: Result[]): string {
  const base = (model: ModelName) =>
    results.find((r) => r.model === model && r.mode === "padded" && r.threads === "default")
      ?.ms_per_window ?? NaN;
  const lines = [
    `CPU: ${cpus()[0]?.model ?? "unknown"} × ${String(cpus().length)}; ${String(results[0]?.steps ?? 0)} timed steps of batch ${String(results[0]?.batch_size ?? 0)} after warm-up.`,
    "",
    "| Model | Threads | Batches | Rows (timed) | Rows (epoch) | ms / step | ms / window | Speed-up | Epoch estimate |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of results) {
    // Step time scales roughly linearly with rows (R15), so rescale to the epoch's mean rows.
    const epochMs = (r.ms_per_window * r.epoch_mean_rows) / r.mean_rows;
    lines.push(
      `| ${r.model} | ${r.threads} | ${r.mode} | ${r.mean_rows.toFixed(0)} | ${r.epoch_mean_rows.toFixed(0)} | ${r.ms_per_step.toFixed(0)} | ${r.ms_per_window.toFixed(2)} | ${(base(r.model) / r.ms_per_window).toFixed(2)}× | ${(base(r.model) / epochMs).toFixed(2)}× |`,
    );
  }
  lines.push(
    "",
    "Speed-up: per window against default threads with padded batches, on the timed steps. Rows (timed) is the mean over the timed steps; Rows (epoch) over every full batch of the epoch. Epoch estimate rescales the timed ms per window to the epoch's mean rows (step time is roughly linear in rows).",
  );
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      train: { type: "string" },
      out: { type: "string" },
      steps: { type: "string", default: "8" },
      warmup: { type: "string", default: "2" },
      child: { type: "string" },
    },
  });
  const steps = Number(values.steps);
  const warmup = Number(values.warmup);
  if (!values.train || !Number.isInteger(steps) || steps < 1 || !Number.isInteger(warmup)) {
    throw new Error(
      "usage: bench-train.ts --train <train.features.bin> --out <dir> [--steps n] [--warmup n]",
    );
  }
  if (values.child !== undefined) {
    const [model, mode] = values.child.split(":") as [ModelName, Mode];
    await child(values.train, model, mode, steps, warmup);
    return;
  }
  if (!values.out) throw new Error("--out is required");
  const results: Result[] = [];
  for (const model of Object.keys(MODELS) as ModelName[]) {
    for (const threads of THREADS) {
      for (const mode of MODES) {
        const env: NodeJS.ProcessEnv = { ...process.env };
        delete env.TF_NUM_INTRAOP_THREADS;
        delete env.TF_NUM_INTEROP_THREADS;
        if (threads !== "default") {
          env.TF_NUM_INTRAOP_THREADS = threads;
          env.TF_NUM_INTEROP_THREADS = threads;
        }
        const run = spawnSync(
          process.execPath,
          [
            fileURLToPath(import.meta.url),
            "--child",
            `${model}:${mode}`,
            "--train",
            values.train,
            "--steps",
            String(steps),
            "--warmup",
            String(warmup),
          ],
          { env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
        );
        if (run.status !== 0) throw new Error(`${model} ${mode} threads=${threads} failed`);
        const r = JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "{}") as Result;
        process.stderr.write(`${JSON.stringify(r)}\n`);
        results.push(r);
      }
    }
  }
  mkdirSync(values.out, { recursive: true });
  writeFileSync(join(values.out, "bench.json"), `${JSON.stringify(results, null, 2)}\n`);
  const md = table(results);
  writeFileSync(join(values.out, "bench.md"), md);
  process.stdout.write(md);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 2;
});
