// Length bucketing and thread settings (research R15): off by default, deterministic, every window
// once per epoch, and trimming trailing padding leaves outputs and loss unchanged.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as tf from "@tensorflow/tfjs-node";
import { NI, openFeatures, ROWS } from "@tma/features";
import type { ModelKind } from "@tma/types";
import { afterAll, describe, expect, it } from "vitest";
import { buildModel } from "../src/architectures.js";
import { main as cliTrain } from "../src/cli-train.js";
import {
  batchRows,
  checkBucketing,
  epochBatches,
  epochOrder,
  labelMap,
  makeBatch,
  windowLength,
  windowLengths,
} from "../src/batches.js";
import { lossParts, makeLoss, NY, termWeights } from "../src/loss.js";
import { INTEROP_ENV, INTRAOP_ENV, threadSettings } from "../src/threads.js";
import { train } from "../src/train.js";
import { FIXTURE_GIT, g0Experiments, tempDir, tinyConfig, tinyFeatures } from "./helpers.js";

const quiet = () => undefined;
const sorted = (a: ArrayLike<number>) => Array.from(a).sort((p, q) => p - q);
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("length bucketing: batch order", () => {
  const data = tinyFeatures(70);
  const f = openFeatures(data.train);
  const lengths = windowLengths(f, f.count);
  afterAll(() => {
    f.close();
  });
  const cfg = tinyConfig("time_late", { length_bucketing: true, bucket_batches: 2, batch_size: 8 });

  it("window length is one past the last non-zero row", () => {
    for (let k = 0; k < f.count; k++) {
      const w = f.read(k);
      const n = lengths[k] ?? 0;
      expect(n).toBeGreaterThan(0);
      expect(n).toBe(windowLength(w.inputs));
      expect(w.inputs[(n - 1) * NI + NI - 1]).toBe(1); // window_mask on the last row
      expect(w.inputs.subarray(n * NI).every((v) => v === 0)).toBe(true);
    }
    expect(new Set(lengths).size).toBeGreaterThan(5); // the tiny set spans many lengths
  });

  it("is off by default: batches are consecutive slices of the epoch permutation", () => {
    const plain = tinyConfig("time_late", { batch_size: 8 });
    const order = epochOrder(plain, 3, 70);
    const got = epochBatches(plain, 3, 70);
    expect(got.map((b) => b.length)).toEqual([8, 8, 8, 8, 8, 8, 8, 8, 6]);
    expect(got.flatMap((b) => Array.from(b))).toEqual(Array.from(order));
    for (const b of got) expect(batchRows(plain, b, lengths)).toBe(ROWS);
  });

  it("is deterministic and holds every window exactly once per epoch", () => {
    for (const e of [0, 1, 2]) {
      const a = epochBatches(cfg, e, 70, lengths);
      const b = epochBatches(cfg, e, 70, lengths);
      expect(a.map((x) => Array.from(x))).toEqual(b.map((x) => Array.from(x)));
      expect(sorted(a.flatMap((x) => Array.from(x)))).toEqual(range(70));
      expect(a.filter((x) => x.length !== 8)).toHaveLength(1); // only the last group's tail
    }
    const e0 = epochBatches(cfg, 0, 70, lengths).map((x) => Array.from(x));
    const e1 = epochBatches(cfg, 1, 70, lengths).map((x) => Array.from(x));
    expect(e0).not.toEqual(e1);
    const other = tinyConfig("time_late", { ...cfg, train_seed: "8" });
    expect(epochBatches(other, 0, 70, lengths).map((x) => Array.from(x))).not.toEqual(e0);
  });

  it("sorts each group by length and draws each group from the epoch permutation", () => {
    const order = epochOrder(cfg, 0, 70);
    const group = 16; // bucket_batches × batch_size
    const batches = epochBatches(cfg, 0, 70, lengths);
    // Each batch lies inside one group, and within a group the batches tile the sorted lengths.
    for (let g = 0; g < 70; g += group) {
      const members = new Set(order.subarray(g, Math.min(70, g + group)));
      const inGroup = batches.filter((b) => members.has(b[0] ?? -1));
      for (const b of inGroup) for (const k of b) expect(members.has(k)).toBe(true);
      const spans = inGroup
        .map((b) => [
          Math.min(...Array.from(b, (k) => lengths[k] ?? 0)),
          batchRows(cfg, b, lengths),
        ])
        .sort((p, q) => (p[0] ?? 0) - (q[0] ?? 0));
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i]?.[0] ?? 0).toBeGreaterThanOrEqual(spans[i - 1]?.[1] ?? 0);
      }
    }
    // Trimming saves rows on this set.
    const rows = batches.reduce((s, b) => s + b.length * batchRows(cfg, b, lengths), 0);
    expect(rows).toBeLessThan(70 * ROWS);
  });

  it("refuses mlp and bad group sizes", () => {
    const mlp = tinyConfig("mlp", { length_bucketing: true });
    expect(() => {
      checkBucketing(mlp);
    }).toThrow(/not supported for mlp/);
    expect(() => buildModel(mlp)).toThrow(/not supported for mlp/);
    expect(() => {
      checkBucketing(tinyConfig("instantaneous", { length_bucketing: true, bucket_batches: 0 }));
    }).toThrow(/bucket_batches/);
    expect(() => epochBatches(cfg, 0, 70)).toThrow(/lengths/);
  });

  it("trims a batch to its longest window and keeps its rows unchanged", () => {
    const ks = Uint32Array.from([3, 9, 20]);
    const rows = batchRows(cfg, ks, lengths);
    expect(rows).toBe(Math.max(...Array.from(ks, (k) => lengths[k] ?? 0)));
    const labels = labelMap(cfg, 70);
    const full = makeBatch(f, ks, cfg, labels);
    const cut = makeBatch(f, ks, cfg, labels, rows);
    expect(cut.rows).toBe(rows);
    for (let j = 0; j < ks.length; j++) {
      expect(cut.x.subarray(j * rows * NI, (j + 1) * rows * NI)).toEqual(
        full.x.subarray(j * ROWS * NI, (j * ROWS + rows) * NI),
      );
      expect(cut.y.subarray(j * rows * NY, (j + 1) * rows * NY)).toEqual(
        full.y.subarray(j * ROWS * NY, (j * ROWS + rows) * NY),
      );
      // Dropped rows carried no loss weight.
      for (let r = rows; r < ROWS; r++) expect(full.y[(j * ROWS + r) * NY + NY - 1]).toBe(0);
    }
  });
});

const VARIABLE: ModelKind[] = ["instantaneous", "time_late", "causal_cnn"];

describe("length bucketing: variable time dimension leaves outputs unchanged", () => {
  const data = tinyFeatures(24, 5n);
  const f = openFeatures(data.train);
  const lengths = windowLengths(f, f.count);
  afterAll(() => {
    f.close();
  });
  // A batch of mixed lengths, none full-length, so trimming removes rows.
  const ks = Uint32Array.from([0, 1, 2, 3, 4, 5]);

  it.each(VARIABLE)("%s: same parameters; identical outputs on full and trimmed input", (kind) => {
    const fixed = buildModel(tinyConfig(kind));
    const cfg = tinyConfig(kind, { length_bucketing: true });
    const variable = buildModel(cfg);
    expect(variable.inputs[0]?.shape).toEqual([null, null, NI]);
    expect(fixed.inputs[0]?.shape).toEqual([null, ROWS, NI]);
    expect(variable.countParams()).toBe(fixed.countParams());
    const wf = fixed.getWeights().map((w) => w.dataSync());
    const wv = variable.getWeights().map((w) => w.dataSync());
    expect(wv).toEqual(wf); // same seeded initial values

    const labels = labelMap(cfg, f.count);
    const rows = batchRows(cfg, ks, lengths);
    expect(rows).toBeLessThan(ROWS);
    const full = makeBatch(f, ks, cfg, labels);
    const cut = makeBatch(f, ks, cfg, labels, rows);
    const xf = tf.tensor3d(full.x, [full.size, ROWS, NI]);
    const xc = tf.tensor3d(cut.x, [cut.size, rows, NI]);
    const pFixed = (fixed.predict(xf) as tf.Tensor).dataSync();
    const pFull = (variable.predict(xf) as tf.Tensor).dataSync();
    const pCut = (variable.predict(xc) as tf.Tensor).dataSync();
    // Full-length input: bit-identical to the fixed-shape model.
    expect(pFull).toEqual(pFixed);
    // Trimmed input: every kept row is bit-identical to the padded batch.
    const no = 4;
    for (let j = 0; j < ks.length; j++) {
      expect(pCut.subarray(j * rows * no, (j + 1) * rows * no)).toEqual(
        pFull.subarray(j * ROWS * no, (j * ROWS + rows) * no),
      );
    }
    // Loss: the dropped rows had zero weight, so the weighted sums agree.
    const w = termWeights(cfg);
    const yf = tf.tensor3d(full.y, [full.size, ROWS, NY]);
    const yc = tf.tensor3d(cut.y, [cut.size, rows, NY]);
    const lf = lossParts(w, yf, variable.predict(xf) as tf.Tensor);
    const lc = lossParts(w, yc, variable.predict(xc) as tf.Tensor);
    expect(lc.den.dataSync()[0]).toBe(lf.den.dataSync()[0]);
    const nf = lf.num.dataSync()[0] ?? NaN;
    expect(Math.abs((lc.num.dataSync()[0] ?? NaN) - nf) / nf).toBeLessThan(1e-6);
    const loss = makeLoss(cfg);
    const a = loss(yf, variable.predict(xf) as tf.Tensor).dataSync()[0] ?? NaN;
    const b = loss(yc, variable.predict(xc) as tf.Tensor).dataSync()[0] ?? NaN;
    expect(Math.abs(b - a) / a).toBeLessThan(1e-6);
  });

  it.each(VARIABLE)("%s: one gradient step on the trimmed batch matches the padded one", (kind) => {
    const cfg = tinyConfig(kind, { length_bucketing: true });
    const labels = labelMap(cfg, f.count);
    const rows = batchRows(cfg, ks, lengths);
    const step = (r: number): Float32Array[] => {
      const m = buildModel(cfg);
      const b = makeBatch(f, ks, cfg, labels, r);
      const x = tf.tensor3d(b.x, [b.size, r, NI]);
      const y = tf.tensor3d(b.y, [b.size, r, NY]);
      const loss = makeLoss(cfg);
      tf.train.sgd(0.1).minimize(() => loss(y, m.apply(x, { training: true }) as tf.Tensor), false);
      return m.getWeights().map((t) => t.dataSync() as Float32Array);
    };
    const a = step(ROWS);
    const b = step(rows);
    expect(b).toHaveLength(a.length);
    for (let i = 0; i < a.length; i++) {
      const p = a[i] ?? new Float32Array(0);
      const q = b[i] ?? new Float32Array(0);
      for (let k = 0; k < p.length; k++) expect(q[k]).toBeCloseTo(p[k] ?? NaN, 6);
    }
  });
});

describe("length bucketing: training", () => {
  const data = tinyFeatures(48);

  it.each(VARIABLE)(
    "%s trains deterministically with bucketing",
    async (kind) => {
      const run = (outDir: string) =>
        train({
          config: tinyConfig(kind, { length_bucketing: true, bucket_batches: 2 }),
          trainPath: data.train,
          valPath: data.val,
          outDir,
          log: quiet,
        });
      const out = tempDir();
      const a = await run(out);
      const b = await run(tempDir());
      expect(a.complete).toBe(true);
      expect(b.weights_digest).toBe(a.weights_digest);
      expect(a.config.length_bucketing).toBe(true);
      // The saved model predicts full windows exactly as a fixed-shape model with its weights.
      const saved = await tf.loadLayersModel(`file://${join(out, "model.json")}`);
      expect(saved.inputs[0]?.shape).toEqual([null, null, NI]);
      const fixed = buildModel(tinyConfig(kind));
      fixed.setWeights(saved.getWeights());
      const f = openFeatures(data.val);
      const cfg = tinyConfig(kind);
      const batch = makeBatch(f, range(f.count), cfg, labelMap(cfg, f.count));
      f.close();
      const x = tf.tensor3d(batch.x, [batch.size, ROWS, NI]);
      expect((saved.predict(x) as tf.Tensor).dataSync()).toEqual(
        (fixed.predict(x) as tf.Tensor).dataSync(),
      );
    },
    120_000,
  );

  it("refuses mlp before training", async () => {
    await expect(
      train({
        config: tinyConfig("mlp", { length_bucketing: true }),
        trainPath: data.train,
        valPath: data.val,
        outDir: tempDir(),
        log: quiet,
      }),
    ).rejects.toThrow(/not supported for mlp/);
  });
});

describe("tfjs threads", () => {
  it("records the thread environment in the manifest only when it is set", async () => {
    const data = tinyFeatures(16);
    const saved = [process.env[INTRAOP_ENV], process.env[INTEROP_ENV]];
    const restore = () => {
      for (const [k, v] of [
        [INTRAOP_ENV, saved[0]],
        [INTEROP_ENV, saved[1]],
      ] as const) {
        if (v === undefined) Reflect.deleteProperty(process.env, k);
        else process.env[k] = v;
      }
    };
    try {
      Reflect.deleteProperty(process.env, INTRAOP_ENV);
      Reflect.deleteProperty(process.env, INTEROP_ENV);
      expect(threadSettings()).toEqual({});
      const cfg = tinyConfig("instantaneous", { max_epochs: 1 });
      const plain = await train({
        config: cfg,
        trainPath: data.train,
        valPath: data.val,
        outDir: tempDir(),
        log: quiet,
      });
      expect(plain).not.toHaveProperty("tf_intraop_threads");
      expect(plain).not.toHaveProperty("tf_interop_threads");
      // tma-train applies tfjs_threads to the environment and the manifest records it. (In this
      // process tfjs-node is already loaded, so the pools keep their size; see the next test.)
      const dir = tempDir();
      const configPath = join(dir, "config.json");
      writeFileSync(
        configPath,
        JSON.stringify(tinyConfig("instantaneous", { max_epochs: 1, tfjs_threads: 1 })),
      );
      const out = join(dir, "model");
      const summary = (await cliTrain(
        [
          "--config",
          configPath,
          "--train",
          data.train,
          "--val",
          data.val,
          "--out",
          out,
          "--experiments",
          g0Experiments(),
        ],
        FIXTURE_GIT,
      )) as Record<string, unknown>;
      expect(summary.tf_intraop_threads).toBe(1);
      expect(summary.tf_interop_threads).toBe(1);
      expect(process.env[INTRAOP_ENV]).toBe("1");
      const disk = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as {
        tf_intraop_threads?: number;
        tf_interop_threads?: number;
        config: { tfjs_threads?: number };
        g0_experiment?: string;
        source_dataset_header?: { split: string; generator_git_commit: string };
      };
      // Lineage (spec 003 US1): the accepted G0 and the train dataset's header are recorded.
      expect(summary.g0_experiment).toBe("g0");
      expect(disk.g0_experiment).toBe("g0");
      expect(disk.source_dataset_header?.split).toBe("train");
      expect(disk.source_dataset_header?.generator_git_commit).toBe("f".repeat(40));
      expect(disk.tf_intraop_threads).toBe(1);
      expect(disk.tf_interop_threads).toBe(1);
      expect(disk.config.tfjs_threads).toBe(1);
    } finally {
      restore();
    }
  }, 120_000);

  // Counts threads through /proc, so Linux only.
  it.skipIf(process.platform !== "linux")(
    "applyThreads before importing tfjs-node sizes its thread pools",
    () => {
      const threadsTs = fileURLToPath(new URL("../src/threads.ts", import.meta.url));
      const script = `
      import { readdirSync } from "node:fs";
      import { applyThreads } from ${JSON.stringify(threadsTs)};
      applyThreads(Number(process.argv[1]));
      const tf = await import("@tensorflow/tfjs-node");
      const a = tf.randomNormal([256, 256]);
      for (let i = 0; i < 4; i++) tf.matMul(a, a).dataSync();
      process.stdout.write(String(readdirSync("/proc/self/task").length));
    `;
      const count = (n: number): number => {
        const env: NodeJS.ProcessEnv = { ...process.env };
        Reflect.deleteProperty(env, INTRAOP_ENV);
        Reflect.deleteProperty(env, INTEROP_ENV);
        const out = execFileSync(
          process.execPath,
          ["--input-type=module", "--no-warnings", "-e", script, String(n)],
          {
            cwd: fileURLToPath(new URL("..", import.meta.url)),
            env,
            stdio: ["ignore", "pipe", "ignore"],
          },
        );
        return Number(out.toString());
      };
      // Intra-op and inter-op pools each grow by three threads from 1 to 4.
      expect(count(4) - count(1)).toBe(6);
    },
    60_000,
  );
});
