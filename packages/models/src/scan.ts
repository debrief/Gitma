// Side-experiment scan (spec 003 research R20): every model in a folder scored on the validation
// split beside naive and classical, with bootstrap intervals on the medians. No gate, no roles,
// and the test split is never read. Used to compare capacities (units, stacked layers) at a
// fixed budget before a gate iteration commits to one.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLASSICAL, fileDigest, fitNaive, NAIVE } from "@tma/classical";
import { readDataset } from "@tma/data";
import {
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  bootstrapEvaluation,
  evaluate,
  makeManifest,
  perTimestep,
  writeBootstrap,
  writeEvaluation,
  writeManifest,
} from "@tma/eval";
import { G2_POINTS, type ModelSet, scoreSplit } from "./g2.js";
import { readModelManifest } from "./manifest-io.js";
import { loadModel } from "./predict.js";

export interface ScanOptions {
  data: string;
  models: string;
  experiment: string;
  commandLine: string;
  log?: (line: string) => void;
  resamples?: number;
}

/** The slice and points a scan reports: the G2 slice, range and course at 300 s, speed at 600 s. */
export const SCAN_SLICE = "sigma=1deg";

/** One estimator's row of `scan.md`. */
export interface ScanRow {
  estimator: string;
  /** Model rows only. */
  params?: number;
  epochs?: number;
  best_epoch?: number;
  seconds_per_epoch?: number;
  loss_weight_speed?: number;
  n300: number;
  n600: number;
  range: string;
  course: string;
  speed: string;
}

/** Every trained model in `dir` (manifest beside it), by id; no role is required. */
export function findAllModels(dir: string): ModelSet["models"] {
  const models = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "manifest.json")))
    .map((e) => ({ dir: join(dir, e.name), manifest: readModelManifest(join(dir, e.name)) }))
    .sort((a, b) => (a.manifest.id < b.manifest.id ? -1 : 1));
  if (models.length === 0) throw new Error(`${dir}: no trained models`);
  if (new Set(models.map((m) => m.manifest.id)).size !== models.length) {
    throw new Error(`${dir}: duplicate model ids`);
  }
  return models;
}

type Metrics = ReturnType<typeof evaluate>["metrics"];
type Report = ReturnType<typeof bootstrapEvaluation>;

const fmt = (v: number | null | undefined, f: (x: number) => string): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "∞" : f(v);
const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;
const deg = (x: number): string => `${x.toFixed(2)}°`;
const kt = (x: number): string => `${x.toFixed(2)} kt`;

/** "median [lo, hi]" for one estimator, point and metric on the scan slice. */
function cell(
  metrics: Metrics,
  report: Report,
  label: string,
  point: string,
  field: "range_rel_median" | "course_deg_median" | "speed_kt_median",
  f: (x: number) => string,
): string {
  const m = metrics.find(
    (r) => r.estimator === label && r.slice === SCAN_SLICE && r.point === point,
  );
  const metric = field.replace(/_median$/, "");
  const ci = report.medians.find(
    (x) =>
      x.estimator === label && x.slice === SCAN_SLICE && x.point === point && x.metric === metric,
  );
  const value = fmt(m?.[field], f);
  return ci === undefined ? value : `${value} [${fmt(ci.lo, f)}, ${fmt(ci.hi, f)}]`;
}

function row(metrics: Metrics, report: Report, label: string): ScanRow {
  const n = (point: string): number =>
    metrics.find((r) => r.estimator === label && r.slice === SCAN_SLICE && r.point === point)?.n ??
    0;
  return {
    estimator: label.replace(/:per_timestep$/, ""),
    n300: n("zig+300s"),
    n600: n("zig+600s"),
    range: cell(metrics, report, label, "zig+300s", "range_rel_median", pct),
    course: cell(metrics, report, label, "zig+300s", "course_deg_median", deg),
    speed: cell(metrics, report, label, "zig+600s", "speed_kt_median", kt),
  };
}

export function scanMarkdown(rows: ScanRow[], resamples: number): string {
  const num = (v: number | undefined, f = (x: number): string => String(x)): string =>
    v === undefined ? "–" : f(v);
  const lines = [
    "# Capacity scan (validation split; reported, never gated)",
    "",
    `σ = 1° slice. Medians with ${String(resamples)}-resample bootstrap 95% intervals; range and course at`,
    "zig + 300 s, speed at zig + 600 s (the G2 points). Naive and classical on the same rows.",
    "",
    "| Estimator | Params | Epochs (best) | s / epoch | Speed weight | n (300 / 600) | Range | Course | Speed |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| \`${r.estimator}\` | ${num(r.params, (x) => x.toLocaleString("en-GB"))} | ${num(r.epochs)}${
          r.best_epoch === undefined ? "" : ` (${String(r.best_epoch)})`
        } | ${num(r.seconds_per_epoch, (x) => x.toFixed(0))} | ${num(r.loss_weight_speed)} | ${String(r.n300)} / ${String(r.n600)} | ${r.range} | ${r.course} | ${r.speed} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

/** Scores every model on validation and writes metrics, bootstrap, curves, scan.md and a manifest. */
export async function runScan(opts: ScanOptions): Promise<ScanRow[]> {
  const log = opts.log ?? ((l: string) => process.stderr.write(`${l}\n`));
  const resamples = opts.resamples ?? BOOTSTRAP_RESAMPLES;
  const models = findAllModels(opts.models);
  const trainPath = join(opts.data, "train.f32pack");
  const valPath = join(opts.data, "validation.f32pack");
  const train = readDataset(trainPath);
  const naive = fitNaive(train.scenarios(), fileDigest(trainPath));
  const scored = await scoreSplit(opts, "validation", naive, train.header, [{ models }], log);
  const ev = evaluate(scored.truth, scored.sets, { points: G2_POINTS, curveStep: 60 });
  mkdirSync(opts.experiment, { recursive: true });
  writeEvaluation(opts.experiment, ev);
  const report = bootstrapEvaluation(scored.truth, scored.sets, {
    points: G2_POINTS,
    resamples,
    seed: BOOTSTRAP_SEED,
    reference: perTimestep(NAIVE),
  });
  writeBootstrap(opts.experiment, report);

  const rows: ScanRow[] = [
    row(ev.metrics, report, perTimestep(NAIVE)),
    row(ev.metrics, report, perTimestep(CLASSICAL)),
  ];
  for (const m of models) {
    const model = await loadModel(m.dir);
    const params = model.countParams();
    model.dispose();
    const epochs = m.manifest.epochs;
    const first = epochs[0];
    const last = epochs.at(-1);
    const r = row(ev.metrics, report, perTimestep(m.manifest.id));
    r.params = params;
    r.epochs = epochs.length;
    r.best_epoch = m.manifest.best_epoch;
    if (first !== undefined && last !== undefined && epochs.length > 1) {
      r.seconds_per_epoch = (last.seconds - first.seconds) / (epochs.length - 1);
    }
    r.loss_weight_speed = m.manifest.config.loss_weight_speed;
    rows.push(r);
    const to = join(opts.experiment, "models", m.manifest.id);
    mkdirSync(to, { recursive: true });
    for (const f of ["manifest.json", "model.json", "weights.bin"]) {
      copyFileSync(join(m.dir, f), join(to, f));
    }
  }
  writeFileSync(join(opts.experiment, "scan.md"), scanMarkdown(rows, resamples));

  const id = opts.experiment.split("/").filter(Boolean).at(-1) ?? "scan";
  writeManifest(
    opts.experiment,
    makeManifest(
      id,
      [
        { path: trainPath, header: train.header },
        { path: valPath, header: readDataset(valPath).header },
      ],
      [
        {
          name: NAIVE,
          settings: { fitted_on: "train", mode: "per_timestep", means: naive.per_timestep },
        },
        {
          name: CLASSICAL,
          settings: { method: "levenberg-marquardt", mode: "per_timestep", grid_every: 6 },
        },
        ...models.map((m) => ({
          name: m.manifest.id,
          settings: {
            manifest: `models/${m.manifest.id}/manifest.json`,
            weights_digest: m.manifest.weights_digest,
            config: m.manifest.config,
          },
        })),
      ],
      [
        opts.commandLine,
        "# side experiment (spec 003 R20): validation only, reported, never a gate decision",
        ...scored.notes.map((n) => `# ${n}`),
      ],
    ),
  );
  return rows;
}
