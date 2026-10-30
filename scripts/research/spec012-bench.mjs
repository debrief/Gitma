// Spec 012 R1: training-step cost of the phase-4 trackers on this machine, for comparing a local
// machine with a GitHub runner. Each model runs in its own process, with its config's
// tfjs_threads applied before tfjs-node loads (libtensorflow reads the thread settings once).
//
//   pnpm build
//   node scripts/research/spec012-bench.mjs [--steps 4] [--windows 512]
//
// Generates a small phase-4 set (seed 4242, not a gate seed) in a temporary folder, then times
// full-length (360-row) batches of 256 for T1 (configs/phase4/a) and T2 (configs/phase4/b).
// Timing only: nothing is saved. Prints seconds per batch and hours per 80,000-window epoch,
// padded and scaled by the set's mean window length (an estimate for length bucketing).
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const root = new URL("../../", import.meta.url).pathname;
const MODELS = { T1: "configs/phase4/a/tracker.json", T2: "configs/phase4/b/tracker.json" };
const EPOCH_WINDOWS = 80_000;

async function child(name, windows, steps) {
  const config = JSON.parse(readFileSync(join(root, MODELS[name]), "utf8"));
  // tfjs-node is a dependency of packages/models, not of the workspace root.
  const tf = createRequire(join(root, "packages/models/package.json"))("@tensorflow/tfjs-node");
  const { generateScenario } = await import("../../packages/sim/dist/index.js");
  const { computeNormalisation, openFeatures, rowsFor, writeFeatures } =
    await import("../../packages/features/dist/index.js");
  const { buildModel, labelMap, makeBatch, makeLoss, trainStep, windowLengths } =
    await import("../../packages/models/dist/index.js");
  const ranges = JSON.parse(readFileSync(join(root, "configs/phase4-ranges.json"), "utf8"));
  const fs = config.feature_set ?? "raw";
  const ss = Array.from({ length: windows }, (_, i) => generateScenario(4242n, i, ranges).scenario);
  const dir = mkdtempSync(join(tmpdir(), "spec012-bench-"));
  try {
    const path = join(dir, "train.features.bin");
    const norm = computeNormalisation(ss, "bench", fs);
    const source = {
      header: {
        record: "header",
        schema_version: "bench",
        generator_version: "bench",
        dataset_seed: "4242",
        split: "train",
        scenario_count: windows,
        index_start: 0,
        index_end: windows,
        parameter_ranges: ranges,
        redraw_count: 0,
        created_by: "spec012-bench",
        generator_git_commit: "0".repeat(40),
        generator_git_dirty: true,
      },
      digest: "0".repeat(64),
    };
    writeFeatures(path, () => ss, norm, source, fs);
    const file = openFeatures(path);
    const rows = rowsFor(ranges);
    const lengths = windowLengths(file, windows);
    const meanRows = lengths.reduce((a, b) => a + b, 0) / windows;
    const model = buildModel(config, file.inputChannels, rows);
    const loss = makeLoss(config);
    const opt = tf.train.adam(config.learning_rate);
    const labels = labelMap(config, windows);
    const b = config.batch_size;
    const times = [];
    for (let s = 0; s <= steps; s++) {
      const ks = Array.from({ length: b }, (_, j) => (s * b + j) % windows);
      const batch = makeBatch(file, ks, config, labels, rows);
      const t0 = performance.now();
      const x = tf.tensor3d(batch.x, [b, rows, file.inputChannels]);
      const y = tf.tensor3d(batch.y, [b, rows, batch.y.length / (b * rows)]);
      trainStep(model, opt, loss, x, y);
      x.dispose();
      y.dispose();
      if (s > 0) times.push((performance.now() - t0) / 1000); // step 0 is warm-up
    }
    file.close();
    const sPerBatch = times.reduce((a, c) => a + c, 0) / times.length;
    const hPadded = (sPerBatch * EPOCH_WINDOWS) / b / 3600;
    console.log(
      JSON.stringify({
        model: name,
        id: config.id,
        threads: config.tfjs_threads ?? "default",
        s_per_batch: +sPerBatch.toFixed(2),
        h_per_epoch_padded: +hPadded.toFixed(2),
        mean_rows: +meanRows.toFixed(0),
        rows,
        h_per_epoch_bucketed_est: +((hPadded * meanRows) / rows).toFixed(2),
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const { values } = parseArgs({
  options: {
    steps: { type: "string", default: "4" },
    windows: { type: "string", default: "512" },
    child: { type: "string" },
  },
});
const steps = Number(values.steps);
const windows = Number(values.windows);
if (values.child) {
  await child(values.child, windows, steps);
} else {
  console.log(`${cpus()[0]?.model ?? "unknown CPU"}, ${cpus().length} logical cores`);
  for (const name of Object.keys(MODELS)) {
    const config = JSON.parse(readFileSync(join(root, MODELS[name]), "utf8"));
    const env = { ...process.env };
    if (config.tfjs_threads) {
      env.TF_NUM_INTRAOP_THREADS = String(config.tfjs_threads);
      env.TF_NUM_INTEROP_THREADS = String(config.tfjs_threads);
    }
    const r = spawnSync(
      process.execPath,
      [
        new URL(import.meta.url).pathname,
        "--child",
        name,
        "--steps",
        String(steps),
        "--windows",
        String(windows),
      ],
      { env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
    process.stdout.write(
      r.stdout
        .split("\n")
        .filter((l) => l.startsWith("{"))
        .join("\n") + "\n",
    );
  }
}
