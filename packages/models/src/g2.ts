// One-command G2 run (spec 003 T038, contracts/cli.md `tma-g2`): naive and classical per-timestep,
// every trained model's predictions, then the library equivalent of
//   tma-eval --points 300,600 --bootstrap 2000 --compare-to classical:per_timestep
//   tma-gate g2
// on one split. `--split validation` is the phase diagnostic (research R5): it reads only the train
// and validation splits and writes `diagnostic.json`, never `verdict.json`, so a validation result
// cannot be mistaken for the gate. `--split test` is the G2 decision: when a phase B exists it needs
// a committed decision record (SC-005), and it also scores the held-out split (FR-019).
// `--rescore-of <experiment>` is SRD §7's one re-score of an inconclusive gate on a larger
// fresh-seed test split: the same frozen models, bound by weights digests in the committed decision
// (see `requireRescore`). Scoring streams: predictions go to their files as they are made and
// evaluation reads truth and predictions back lazily, so memory does not grow with the split.
// Lives here rather than in @tma/eval so tfjs-node stays out of the evaluation package.
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  CLASSICAL,
  classicalPredict,
  fileDigest,
  fitNaive,
  NAIVE,
  naivePredict,
} from "@tma/classical";
import { fileSha256, readDataset } from "@tma/data";
import {
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  bootstrapEvaluation,
  bootstrapMedianRatio,
  compareOnCommonRows,
  evaluate,
  type G1Ids,
  g2Checks,
  g2Verdict,
  makeManifest,
  openPredictionSet,
  openPredictionWriter,
  type PredictionSet,
  perTimestep,
  prettyJson,
  rowError,
  scenarioSource,
  sliceKeys,
  writeBootstrap,
  writeComparison,
  writeEvaluation,
  writeManifest,
  writePredictionStream,
  writeVerdict,
} from "@tma/eval";
import { type FeatureFile, openFeatures, outputSpec, writeFeatures } from "@tma/features";
import {
  ChangeDecision,
  ExperimentManifest,
  type FeatureSet,
  GateVerdict,
  type NaiveModel,
  parseRecord,
  type Prediction,
  RecordError,
  type Scenario,
} from "@tma/types";
import { findModels } from "./g1.js";
import { readModelManifest } from "./manifest-io.js";
import {
  loadModel,
  predictEach,
  requireSameFeatureSet,
  requireSameNormalisation,
} from "./predict.js";

export type G2Split = "validation" | "test";

/** Seconds after the zig scored: range and course at 300, speed at 600 (decision 8). */
export const G2_POINTS = [300, 600];
/** Validation runs write their checks here instead of verdict.json (not a gate decision). */
export const DIAGNOSTIC_FILE = "diagnostic.json";
/** Phase-B configs: their presence means a phase B exists, so test scoring needs a decision. */
export const PHASE_B_CONFIGS = "configs/iter2/b";
const COMPARE_TO = perTimestep(CLASSICAL);

export interface G2RunOptions {
  data: string;
  models: string;
  experiment: string;
  split: G2Split;
  /** The other phase's models, scored into `<experiment>/other-phase/` (reported, not gated). */
  compareModels?: string;
  /** Committed decision record (decision.json); required for test when a phase B exists. */
  decision?: string;
  commandLine: string;
  log?: (line: string) => void;
  /** Directory whose existence means a phase B exists (default configs/iter2/b). */
  phaseBDir?: string;
  /** Whether a file is committed and unmodified (default: git in the working directory). */
  isCommitted?: (path: string) => boolean;
  /** Plan whose content digests the data must match (configs/<…>/plan.json); required for test. */
  plan?: string;
  /** Checks `data` against the plan's digests; returns the report lines, throws on a mismatch. */
  checkPlan?: (plan: string, data: string) => string[];
  /** Whether the commit that added `decision` is an ancestor of `commit` (default: git). */
  decisionPrecedes?: (decision: string, commit: string) => boolean;
  resamples?: number;
  /**
   * The inconclusive gate experiment this run re-scores (SRD §7; `--rescore-of`). A decision whose
   * `rescore_of` is set also selects re-score mode; both must then name the same directory.
   */
  rescoreOf?: string;
  /** Score the held-out split with the test split (FR-019; default true, never in a re-score). */
  heldout?: boolean;
}

/** `node scripts/train-plan.mjs check-digests <plan> <data>` (G2 panel R19: content, not headers). */
export function checkPlanDigests(plan: string, data: string): string[] {
  try {
    const out = execFileSync(
      process.execPath,
      ["scripts/train-plan.mjs", "check-digests", plan, data],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return out.trim().split("\n");
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new RecordError(plan, "digests", (err.stderr ?? err.message).trim());
  }
}

/** A repository-relative path in one spelling: forward slashes, no leading "./". */
const normPath = (p: string): string => p.replace(/\\/g, "/").replace(/^(\.\/)+/, "");

/** Test seeds from this one on are bound to their decision by content (spec 007: seed 204). */
export const FIRST_BOUND_SEED = 204;

/** Two spellings of one file: the same resolved real path when both exist, else the same text. */
function samePath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return normPath(a) === normPath(b);
  }
}

/** `dataset_seed` from the header of `<data>/test.f32pack`; undefined when absent or unreadable. */
function dataTestSeed(data: string): string | undefined {
  const path = join(data, "test.f32pack");
  if (!existsSync(path)) return undefined;
  try {
    return readDataset(path).header.dataset_seed;
  } catch {
    return undefined;
  }
}

/** The plan's test seed (its fresh test split's, else its dataset's); undefined if unreadable. */
function testSeedOf(plan: string | undefined): string | undefined {
  if (plan === undefined || !existsSync(plan)) return undefined;
  try {
    const p = JSON.parse(readFileSync(plan, "utf8")) as {
      dataset?: { seed?: string; fresh_test?: { seed?: string } };
    };
    return p.dataset?.fresh_test?.seed ?? p.dataset?.seed;
  } catch {
    return undefined;
  }
}

/** True when the commit that first added `path` is an ancestor of (or equal to) `commit`. */
export function gitDecisionPrecedes(path: string, commit: string): boolean {
  try {
    const added = execFileSync("git", ["log", "--diff-filter=A", "--format=%H", "--", path], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .at(-1);
    if (added === undefined || added === "") return false;
    execFileSync("git", ["merge-base", "--is-ancestor", added, commit], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Paired comparison of the carried set with the other phase, on the same rows (spec 007 FR-006). */
export const PAIRED_FILE = "paired.json";

export interface PairedRecord {
  variant: "instantaneous" | "time_late";
  model: string;
  /** The other phase's model of the same variant, or the classical solver on the same rows. */
  reference: "other-phase" | "classical";
  other: string;
  slice: string;
  metric: "range_rel" | "course_deg" | "speed_kt";
  point_s: number;
  /** median(model) / median(other) with its paired 95% bootstrap interval. */
  ratio: number;
  lo: number;
  hi: number;
  n: number;
  resamples: number;
  seed: string;
}

/** The paired comparison's metrics and points: range and course at 300 s, speed at 600 s. */
const PAIRED_METRICS = [
  ["range_rel", 300],
  ["course_deg", 300],
  ["speed_kt", 600],
] as const;
type PairedMetric = (typeof PAIRED_METRICS)[number][0];

/** A truth source restricted to one slice, still re-iterable (each pass re-reads the source). */
function inSlice(truth: Iterable<Scenario>, slice: string): Iterable<Scenario> {
  return {
    *[Symbol.iterator]() {
      for (const s of truth) if (sliceKeys(s.metadata).includes(slice)) yield s;
    },
  };
}

/**
 * Per scenario of `truth`, each set's error at each paired metric and point, in one pass: the
 * value `pairedErrors` takes for that scenario (+Infinity when not converged; undefined when the
 * set has no row at the point). `out[set][metric]` is aligned with the truth order.
 */
function pointErrors(
  truth: Iterable<Scenario>,
  sets: readonly PredictionSet[],
): Map<PredictionSet, Map<PairedMetric, (number | undefined)[]>> {
  const out = new Map<PredictionSet, Map<PairedMetric, (number | undefined)[]>>();
  for (const set of sets) {
    out.set(set, new Map(PAIRED_METRICS.map(([m]) => [m, [] as (number | undefined)[]])));
  }
  for (const s of truth) {
    for (const set of sets) {
      const p = set.byIndex.get(s.metadata.index);
      if (p === undefined)
        throw new Error(`${set.label}: no prediction for ${String(s.metadata.index)}`);
      const errs = p.rows.map((r) => rowError(s, r));
      for (const [metric, seconds] of PAIRED_METRICS) {
        const e = errs.find((x) => Math.abs(x.t_since_zig_s - seconds) < 1e-6);
        out
          .get(set)
          ?.get(metric)
          ?.push(e === undefined ? undefined : e.converged ? e[metric] : Infinity);
      }
    }
  }
  return out;
}

/** The scenarios where both have a value, as `pairedErrors` pairs them. */
function pairUp(
  a: readonly (number | undefined)[],
  b: readonly (number | undefined)[],
): { a: Float64Array; b: Float64Array } {
  const ea: number[] = [];
  const eb: number[] = [];
  a.forEach((x, i) => {
    const y = b[i];
    if (x === undefined || y === undefined) return;
    ea.push(x);
    eb.push(y);
  });
  return { a: Float64Array.from(ea), b: Float64Array.from(eb) };
}

/**
 * For each sequence model, the paired bootstrap of median error at the G2 points on σ = 1° (range
 * and course at 300 s, speed at 600 s), against the other phase's model of the same variant and
 * against the classical solver, on the same rows. Spec 007 FR-006 reads the instantaneous speed
 * records; the rest are reported. Errors are gathered in one pass over the slice (the same values
 * `pairedErrors` gives per pair), so the prediction files are read once, not once per pair.
 */
export function pairedComparison(
  carried: Scored,
  carriedIds: G1Ids,
  other: Scored,
  otherIds: G1Ids,
  resamples: number,
): PairedRecord[] {
  const slice = "sigma=1deg";
  const find = (sc: Scored, id: string): PredictionSet => {
    const set = sc.sets.find((x) => x.estimator === id);
    if (set === undefined) throw new Error(`paired comparison: no predictions for ${id}`);
    return set;
  };
  const variants = (["instantaneous", "time_late"] as const).map((variant) => {
    const key: keyof G1Ids = variant === "instantaneous" ? "instantaneous" : "timeLate";
    return {
      variant,
      key,
      a: find(carried, carriedIds[key]),
      refs: [
        { reference: "other-phase" as const, set: find(other, otherIds[key]), name: otherIds[key] },
        { reference: "classical" as const, set: find(carried, CLASSICAL), name: CLASSICAL },
      ],
    };
  });
  const used = [...new Set(variants.flatMap((v) => [v.a, ...v.refs.map((r) => r.set)]))];
  const errors = pointErrors(inSlice(carried.truth, slice), used);
  const of = (set: PredictionSet, metric: PairedMetric): (number | undefined)[] =>
    errors.get(set)?.get(metric) ?? [];
  const out: PairedRecord[] = [];
  for (const { variant, key, a, refs } of variants) {
    for (const ref of refs) {
      for (const [metric, point] of PAIRED_METRICS) {
        const e = pairUp(of(a, metric), of(ref.set, metric));
        if (e.a.length === 0) continue;
        const r = bootstrapMedianRatio(e.a, e.b, resamples);
        out.push({
          variant,
          model: carriedIds[key],
          reference: ref.reference,
          other: ref.name,
          slice,
          metric,
          point_s: point,
          ...r,
        });
      }
    }
  }
  return out;
}

/**
 * Every estimator must predict the same rows (scenario and timestamp) as naive, so the gate's
 * same-sample check compares the same rows, not only the same counts (G2 panel R19). Counts are
 * checked first, then one pass over the reference compares every set's rows.
 */
export function requireSameRows(sets: readonly PredictionSet[], what: string): void {
  const [ref, ...rest] = sets;
  if (ref === undefined) return;
  const key = (p: Prediction | undefined): string =>
    p === undefined ? "" : p.rows.map((r) => r.timestamp_s).join(",");
  for (const set of rest) {
    if (set.byIndex.size !== ref.byIndex.size) {
      throw new Error(
        `${what}: ${set.label} predicts ${String(set.byIndex.size)} scenarios, ${ref.label} ${String(ref.byIndex.size)}`,
      );
    }
  }
  for (const [idx, p] of ref.byIndex) {
    const want = key(p);
    for (const set of rest) {
      if (key(set.byIndex.get(idx)) !== want) {
        throw new Error(
          `${what}: ${set.label} and ${ref.label} predict different rows for scenario ${String(idx)}`,
        );
      }
    }
  }
}

/** True when `path` is tracked by git and has no uncommitted change. */
export function gitCommitted(path: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", path], { stdio: "ignore" });
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", path], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * SC-005: test-split scoring after a phase B needs the decision record that chose the change,
 * committed before scoring and saying phase A stalled. Returns the parsed record (or undefined
 * when no phase B exists and none was given).
 */
export function requireDecision(opts: G2RunOptions): ChangeDecision | undefined {
  if (opts.split !== "test") return undefined;
  const phaseB = opts.compareModels !== undefined || existsSync(opts.phaseBDir ?? PHASE_B_CONFIGS);
  // From iteration 3 (spec 007, G0 red team): a test split is scored only with the decision that
  // names its plan, so an earlier iteration's decision cannot unlock a later iteration's test.
  // Bound by the plan's path or by its content (a test seed of 204 or later), however spelled.
  const planSeed = testSeedOf(opts.plan);
  // The test data's own header names its seed, so a forged plan copy cannot unbind it (G0 red
  // team round 3).
  const dataSeed = dataTestSeed(opts.data);
  const isBoundSeed = (seed: string | undefined): boolean =>
    seed !== undefined && /^\d+$/.test(seed) && Number(seed) >= FIRST_BOUND_SEED;
  const iteration = /(?:^|\/)configs\/+(?:\.\/)*iter(\d+)\//.exec(normPath(opts.plan ?? ""));
  const bound =
    (iteration !== null && Number(iteration[1]) >= 3) ||
    isBoundSeed(planSeed) ||
    isBoundSeed(dataSeed);
  if (opts.decision === undefined) {
    if (bound) {
      throw new RecordError(
        "--decision",
        "spec 007",
        `scoring the test split of ${String(opts.plan)} needs --decision <the committed decision.json that names this plan>`,
      );
    }
    if (phaseB) {
      throw new RecordError(
        "--decision",
        "SC-005",
        "a phase B exists: scoring the test split needs --decision <committed decision.json>",
      );
    }
    return undefined;
  }
  const d = parseRecord(
    ChangeDecision,
    JSON.parse(readFileSync(opts.decision, "utf8")),
    opts.decision,
    "decision",
  );
  if (bound && (d.plan == null || !samePath(d.plan, opts.plan ?? ""))) {
    throw new RecordError(
      opts.decision,
      "plan",
      `the decision pre-registers ${d.plan ?? "no plan"}, not ${String(opts.plan)}`,
    );
  }
  if (bound && d.test_seed == null) {
    throw new RecordError(
      opts.decision,
      "test_seed",
      "a decision bound to a plan must name its test seed",
    );
  }
  if (d.test_seed != null && dataSeed !== undefined && dataSeed !== d.test_seed) {
    throw new RecordError(
      opts.decision,
      "test_seed",
      `the decision commits to test seed ${d.test_seed}, but the test data are seed ${dataSeed}`,
    );
  }
  if (d.test_seed != null && opts.plan !== undefined) {
    const seed = planSeed;
    if (seed !== d.test_seed) {
      throw new RecordError(
        opts.decision,
        "test_seed",
        `the decision commits to test seed ${d.test_seed}, but ${opts.plan} tests seed ${String(seed)}`,
      );
    }
  }
  if (!(opts.isCommitted ?? gitCommitted)(opts.decision)) {
    throw new RecordError(
      opts.decision,
      "SC-005",
      "decision record is not committed (or has uncommitted changes): commit it before scoring the test split",
    );
  }
  if (phaseB && !d.stalled) {
    throw new RecordError(
      opts.decision,
      "stalled",
      "a phase B exists but the decision says phase A did not stall",
    );
  }
  return d;
}

/** Features file for a split and feature set: `<split>.<set>.features.bin` if present, else `<split>.features.bin`. */
export function featuresPath(data: string, split: string, fs: FeatureSet): string {
  const specific = join(data, `${split}.${fs}.features.bin`);
  return existsSync(specific) ? specific : join(data, `${split}.features.bin`);
}

export interface Scored {
  /** The split's scenarios, re-read from its .f32pack on every pass (never held in memory). */
  truth: Iterable<Scenario>;
  /** File-backed prediction sets (`openPredictionSet`), read on demand. */
  sets: PredictionSet[];
  notes: string[];
}

export interface ModelSet {
  ids: G1Ids;
  models: { dir: string; manifest: ReturnType<typeof readModelManifest> }[];
}

/** `f` over `xs`, lazily. */
function* mapIter<T, U>(xs: Iterable<T>, f: (x: T) => U): Generator<U> {
  for (const x of xs) yield f(x);
}

/**
 * Naive, classical (cached per split) and every model of each set, on one split. Predictions go
 * to `predictions/<split>.<tag.><estimator>.ndjson` as they are made, and the returned sets read
 * them back on demand; the other phase passes a tag so its files never overwrite the carried
 * set's (same model ids). Nothing of the split is held in memory but one batch.
 */
export async function scoreSplit(
  opts: Pick<G2RunOptions, "data">,
  split: string,
  naive: NaiveModel,
  trainHeader: ReturnType<typeof readDataset>["header"],
  groups: { models: ModelSet["models"] }[],
  log: (l: string) => void,
  tag?: string,
): Promise<Scored> {
  const truthPath = join(opts.data, `${split}.f32pack`);
  const truth = scenarioSource(truthPath);
  const predDir = join(opts.data, "predictions");
  mkdirSync(predDir, { recursive: true });
  const prefix = `${split}.${tag === undefined ? "" : `${tag}.`}`;
  const naivePath = join(predDir, `${prefix}${NAIVE}.ndjson`);
  writePredictionStream(
    naivePath,
    NAIVE,
    truthPath,
    mapIter(truth, (s) => naivePredict(s, naive, "per_timestep")),
  );
  const sets: PredictionSet[] = [openPredictionSet(naivePath, truthPath)];
  const classicalPath = join(predDir, `${split}.classical.ndjson`);
  if (existsSync(classicalPath)) {
    log(`${split}: reusing ${classicalPath}`);
  } else {
    log(
      `${split}: classical per-timestep on ${String(readDataset(truthPath).header.scenario_count)} scenarios`,
    );
    writePredictionStream(
      classicalPath,
      CLASSICAL,
      truthPath,
      mapIter(truth, (s) => classicalPredict(s, "per_timestep")),
    );
  }
  sets.push(openPredictionSet(classicalPath, truthPath));
  const notes: string[] = [];
  for (const g of groups) {
    for (const m of g.models) {
      const fs = m.manifest.config.feature_set ?? "raw";
      const path = featuresPath(opts.data, split, fs);
      // The other phase may use a feature set the plan did not build (spec 008: raw iteration-3
      // models beside derived iteration-4 ones); it then gets its own inputs, as below.
      const missing = tag !== undefined && !existsSync(path);
      let features: FeatureFile | undefined;
      try {
        let note: string | undefined;
        try {
          if (missing) throw new Error(`${path} not built`);
          features = openFeatures(path);
          requireSameFeatureSet(features, m.manifest.config.feature_set, m.manifest.id);
          note = requireSameNormalisation(features, m.manifest.normalisation, m.manifest.id, {
            header: trainHeader,
            modelSchemaVersion: m.manifest.schema_version,
            modelSourceHeader: m.manifest.source_dataset_header,
          });
        } catch (e) {
          // The other phase may come from other training data (spec 007: the 2c models beside
          // iteration 3). Its inputs are then built with its own normalisation, which holds
          // inputs-only constants from its training data; the carried set never takes this path.
          if (tag === undefined) throw e;
          features?.close();
          const own = join(predDir, `${split}.${tag}.${m.manifest.id}.features.bin`);
          const header = readDataset(truthPath).header;
          writeFeatures(
            own,
            () => readDataset(truthPath).scenarios(),
            m.manifest.normalisation,
            { header, digest: fileSha256(truthPath) },
            fs,
          );
          features = openFeatures(own);
          note = `${m.manifest.id} (${tag}): trained on other data, so scored on inputs built with its own normalisation (${own})`;
        }
        if (note !== undefined) notes.push(note);
        // Logged once the inputs are settled: the file actually scored (G2 panel finding 13).
        log(`${split}: predicting ${m.manifest.id} (${fs}, ${features.path})`);
        const model = await loadModel(m.dir);
        const out = join(predDir, `${prefix}${m.manifest.id}.ndjson`);
        const w = openPredictionWriter(out, m.manifest.id, "per_timestep", truthPath);
        try {
          predictEach(
            model,
            features,
            truth,
            m.manifest.normalisation,
            m.manifest.id,
            outputSpec(m.manifest.config),
            256,
            (p) => {
              w.write(p);
            },
          );
          w.commit();
        } catch (e) {
          w.abort();
          throw e;
        } finally {
          model.dispose();
        }
        sets.push(openPredictionSet(out, truthPath));
      } finally {
        features?.close();
      }
    }
  }
  return { truth, sets, notes };
}

/**
 * tma-eval (points, bootstrap, comparison) and the G2 checks, written to `dir`; the verdict (or
 * diagnostic) is returned with a writer, so the caller writes it last, once everything else of
 * the run is on disk (G2 panel finding 8: a verdict.json means a complete run).
 */
function evaluateInto(
  dir: string,
  scored: Scored,
  ids: G1Ids,
  resamples: number,
  verdictFile: "verdict.json" | typeof DIAGNOSTIC_FILE,
  decidedBy?: string,
): { verdict: GateVerdict; write: () => void } {
  const ev = evaluate(scored.truth, scored.sets, { points: G2_POINTS, curveStep: 60 });
  writeEvaluation(dir, ev);
  const report = bootstrapEvaluation(scored.truth, scored.sets, {
    points: G2_POINTS,
    resamples,
    seed: BOOTSTRAP_SEED,
    reference: perTimestep(NAIVE),
  });
  writeBootstrap(dir, report);
  writeComparison(dir, compareOnCommonRows(scored.truth, scored.sets, COMPARE_TO, G2_POINTS));
  const verdict = g2Verdict(g2Checks(ev.metrics, ev.curves, report, ids));
  if (decidedBy !== undefined) verdict.decided_by = decidedBy;
  const write = (): void => {
    if (verdictFile === "verdict.json") writeVerdict(dir, verdict);
    else writeFileSync(join(dir, DIAGNOSTIC_FILE), prettyJson(verdict));
  };
  return { verdict, write };
}

function copyModels(dest: string, g: ModelSet): void {
  for (const m of g.models) {
    const to = join(dest, "models", m.manifest.id);
    mkdirSync(to, { recursive: true });
    for (const f of ["manifest.json", "model.json", "weights.bin"])
      copyFileSync(join(m.dir, f), join(to, f));
  }
}

const VALIDATION_DECIDED_BY =
  "validation diagnostic (spec 003 research R5): not a G2 decision; the gate is judged on test";

/** The manifest note that marks an experiment as a re-score (command_lines, "# " notes). */
export const RESCORE_NOTE = "rescore_of: ";

/** What a re-score was bound to, for the manifest. */
export interface Rescore {
  /** The inconclusive gate experiment re-scored. */
  of: string;
  /** Its test data's seed, and this run's (fresh) one. */
  originalSeed: string;
  seed: string;
  /** Manifest notes: the binding, each weights digest, the held-out split not scored. */
  notes: string[];
}

/** The plan's fresh-test seed (`dataset.fresh_test.seed`); undefined when it has none. */
function freshTestSeedOf(plan: string): string | undefined {
  try {
    const p = JSON.parse(readFileSync(plan, "utf8")) as {
      dataset?: { fresh_test?: { seed?: unknown } };
    };
    const seed = p.dataset?.fresh_test?.seed;
    return typeof seed === "string" ? seed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * SRD §7's one re-score of an inconclusive gate, on a larger fresh-seed test split, bound by
 * content (G2 iteration-4 panel round 1): returns undefined for an ordinary run (no
 * `--rescore-of` and no `rescore_of` in the decision), else checks, refusing with a RecordError,
 *  - the split is test, and the committed decision (checked by `requireDecision`) names this
 *    re-score (`rescore_of`, same path as --rescore-of), this plan, and a test seed equal to the
 *    plan's fresh-test seed and to the test data's own seed;
 *  - the re-scored experiment holds an inconclusive G2 `verdict.json` and a `manifest.json`, is
 *    not itself a re-score (no `# rescore_of:` note), and tested another seed than this one;
 *  - the decision's `model_digests` name exactly the carried models, each with the SHA-256 of
 *    its weights.bin, equal to its manifest's weights_digest (in place of training ancestry);
 *  - the experiment folder holds no verdict.json yet (one scoring).
 */
export function requireRescore(
  opts: G2RunOptions,
  decision: ChangeDecision | undefined,
  carried: ModelSet,
): Rescore | undefined {
  const of = opts.rescoreOf ?? decision?.rescore_of ?? undefined;
  if (of === undefined) return undefined;
  const refuse = (what: string, msg: string): never => {
    throw new RecordError(opts.decision ?? "--rescore-of", what, `re-score of ${of}: ${msg}`);
  };
  if (opts.split !== "test") refuse("split", "a re-score scores the test split only");
  if (opts.decision === undefined || decision === undefined)
    refuse("--decision", "a re-score needs --decision <the committed decision that names it>");
  const d = decision as ChangeDecision;
  if (d.rescore_of == null) refuse("rescore_of", "the decision names no re-score (rescore_of)");
  if (opts.rescoreOf !== undefined && !samePath(d.rescore_of ?? "", opts.rescoreOf))
    refuse("rescore_of", `the decision re-scores ${String(d.rescore_of)}, not ${opts.rescoreOf}`);
  if (opts.plan === undefined) refuse("--plan", "a re-score needs --plan <plan.json>");
  const plan = opts.plan ?? "";
  if (d.plan == null || !samePath(d.plan, plan))
    refuse("plan", `the decision pre-registers ${d.plan ?? "no plan"}, not ${plan}`);
  const fresh = freshTestSeedOf(plan);
  if (fresh === undefined) refuse("fresh_test", `${plan} has no dataset.fresh_test seed`);
  if (d.test_seed == null || d.test_seed !== fresh)
    refuse(
      "test_seed",
      `the decision commits to test seed ${String(d.test_seed)}, the plan's fresh test is seed ${String(fresh)}`,
    );
  const dataSeed = dataTestSeed(opts.data);
  if (dataSeed !== d.test_seed)
    refuse(
      "test_seed",
      `the test data are seed ${String(dataSeed)}, the decision commits to ${String(d.test_seed)}`,
    );
  const seed = d.test_seed ?? "";

  // The re-scored gate: inconclusive, scored, not itself a re-score, another test seed.
  const verdictPath = join(of, "verdict.json");
  const manifestPath = join(of, "manifest.json");
  if (!existsSync(verdictPath)) refuse("verdict", `${verdictPath} does not exist`);
  const verdict = parseRecord(
    GateVerdict,
    JSON.parse(readFileSync(verdictPath, "utf8")),
    verdictPath,
    "verdict",
  );
  if (verdict.gate !== "G2") refuse("verdict", `${verdictPath} is a ${verdict.gate} verdict`);
  if (verdict.result !== "inconclusive")
    refuse(
      "verdict",
      `${verdictPath} is ${verdict.result}: only an inconclusive gate is re-scored (SRD §7)`,
    );
  if (!existsSync(manifestPath)) refuse("manifest", `${manifestPath} does not exist`);
  const manifest = parseRecord(
    ExperimentManifest,
    JSON.parse(readFileSync(manifestPath, "utf8")),
    manifestPath,
    "manifest",
  );
  if (manifest.command_lines.some((l) => l.startsWith(`# ${RESCORE_NOTE}`)))
    refuse("manifest", `${of} is itself a re-score: SRD §7 allows one re-score, then fails`);
  const tests = manifest.datasets.filter((x) => x.header.split === "test");
  const originalSeed = tests[0]?.header.dataset_seed;
  if (tests.length !== 1 || originalSeed === undefined)
    refuse("manifest", `${manifestPath} names ${String(tests.length)} test datasets, not one`);
  if (originalSeed === seed)
    refuse(
      "test_seed",
      `the re-score's test seed ${seed} is the re-scored gate's: a re-score needs a fresh seed`,
    );

  // The frozen models, by content: exactly the carried set, each weights.bin as declared.
  const digests = d.model_digests ?? [];
  const named = digests.map((x) => x.model);
  const ids = carried.models.map((m) => m.manifest.id);
  if (new Set(named).size !== named.length)
    refuse("model_digests", "model_digests names a model twice");
  const missing = ids.filter((id) => !named.includes(id));
  const extra = named.filter((id) => !ids.includes(id));
  if (missing.length > 0 || extra.length > 0)
    refuse(
      "model_digests",
      `model_digests must name exactly the carried models (${ids.join(", ")})${missing.length > 0 ? `; missing ${missing.join(", ")}` : ""}${extra.length > 0 ? `; not carried ${extra.join(", ")}` : ""}`,
    );
  const notes = [
    `${RESCORE_NOTE}${of}`,
    `re-score (SRD §7): ${of} was G2 inconclusive on test seed ${String(originalSeed)}; this run scores fresh test seed ${seed} alone, with the frozen models below bound by weights digest (decision model_digests) in place of training ancestry`,
  ];
  for (const m of carried.models) {
    const want = digests.find((x) => x.model === m.manifest.id)?.weights_sha256;
    const got = fileSha256(join(m.dir, "weights.bin"));
    if (got !== want)
      refuse(
        "model_digests",
        `${m.manifest.id}: weights.bin is sha256 ${got}, the decision names ${String(want)}`,
      );
    if (m.manifest.weights_digest !== got)
      refuse(
        "model_digests",
        `${m.manifest.id}: weights.bin is sha256 ${got}, its manifest says ${m.manifest.weights_digest}`,
      );
    notes.push(
      `re-score model ${m.manifest.id}: weights.bin sha256 ${got} (as the decision names)`,
    );
  }
  if (existsSync(join(opts.experiment, "verdict.json")))
    refuse(
      "experiment",
      `${join(opts.experiment, "verdict.json")} exists: a re-score is scored once, into a new folder`,
    );
  return { of, originalSeed: originalSeed ?? "", seed, notes };
}

/**
 * Every truth and features file the run will score exists, checked before anything is scored
 * (G2 panel finding 8: the first seed-205 invocation stopped at the held-out split after
 * writing verdict.json). The carried models need their own feature set's file; the other phase
 * can build its own inputs, so it needs only the truth.
 */
export function preflight(data: string, splits: readonly string[], carried: ModelSet): void {
  const missing: string[] = [];
  for (const split of ["train", ...splits]) {
    const truth = join(data, `${split}.f32pack`);
    if (!existsSync(truth)) missing.push(truth);
  }
  for (const split of splits) {
    for (const fs of new Set(carried.models.map((m) => m.manifest.config.feature_set ?? "raw"))) {
      const path = featuresPath(data, split, fs);
      if (!existsSync(path)) missing.push(`${path} (${fs} features)`);
    }
  }
  if (missing.length > 0) {
    throw new RecordError(
      data,
      "preflight",
      `not built, so nothing was scored: ${missing.join(", ")} (scripts/train-plan.mjs data <plan> <dir> <splits>)`,
    );
  }
}

export async function runG2(opts: G2RunOptions): Promise<GateVerdict> {
  const log = opts.log ?? ((l: string) => process.stderr.write(`${l}\n`));
  const resamples = opts.resamples ?? BOOTSTRAP_RESAMPLES;
  const decision = requireDecision(opts);
  const carried: ModelSet = findModels(opts.models);
  const rescore = requireRescore(opts, decision, carried);
  // R19: on test, the data must be the plan's (content digests), and the decision must have been
  // committed before the carried weights were trained (not merely committed now). A re-score's
  // models were trained long before its decision: they are bound by weights digest instead.
  let planLines: string[] = [];
  if (opts.split === "test") {
    if (opts.plan === undefined) {
      throw new RecordError(
        "--plan",
        "R19",
        "scoring the test split needs --plan <plan.json>: the data are checked against its content digests",
      );
    }
    planLines = (opts.checkPlan ?? checkPlanDigests)(opts.plan, opts.data);
    if (opts.decision !== undefined && rescore === undefined) {
      const precedes = opts.decisionPrecedes ?? gitDecisionPrecedes;
      for (const m of carried.models) {
        const commit = m.manifest.git_commit;
        if (typeof commit !== "string" || !precedes(opts.decision, commit)) {
          throw new RecordError(
            opts.decision,
            "SC-005",
            `the decision was not committed before ${m.manifest.id} was trained (weights from commit ${String(commit)})`,
          );
        }
      }
    }
  }
  // FR-019: the held-out geometry split is scored with the gate run only (never for validation),
  // and not in a re-score: its held-out split is the re-scored gate's, already reported there.
  const scoreHeldout = opts.split === "test" && rescore === undefined && opts.heldout !== false;
  preflight(opts.data, scoreHeldout ? [opts.split, "heldout"] : [opts.split], carried);
  const other: ModelSet | undefined =
    opts.compareModels === undefined ? undefined : findModels(opts.compareModels);
  const trainPath = join(opts.data, "train.f32pack");
  const train = readDataset(trainPath);
  const naive = fitNaive(train.scenarios(), fileDigest(trainPath));
  const verdictFile = opts.split === "test" ? "verdict.json" : DIAGNOSTIC_FILE;
  const decidedBy = opts.split === "test" ? undefined : VALIDATION_DECIDED_BY;

  const scored = await scoreSplit(opts, opts.split, naive, train.header, [carried], log);
  requireSameRows(scored.sets, opts.split);
  const gate = evaluateInto(
    opts.experiment,
    scored,
    carried.ids,
    resamples,
    verdictFile,
    decidedBy,
  );
  copyModels(opts.experiment, carried);
  const notes = new Set(scored.notes);

  if (other !== undefined) {
    const dir = join(opts.experiment, "other-phase");
    const o = await scoreSplit(opts, opts.split, naive, train.header, [other], log, "other-phase");
    // Reported beside the carried set, never gated (research R5).
    evaluateInto(
      dir,
      o,
      other.ids,
      resamples,
      DIAGNOSTIC_FILE,
      "other phase: reported, not gated (research R5)",
    ).write();
    copyModels(dir, other);
    requireSameRows(o.sets, `${opts.split} (other phase)`);
    for (const n of o.notes) notes.add(n);
    writeFileSync(
      join(opts.experiment, PAIRED_FILE),
      prettyJson(pairedComparison(scored, carried.ids, o, other.ids, resamples)),
    );
  }
  if (scoreHeldout) {
    const h = await scoreSplit(opts, "heldout", naive, train.header, [carried], log);
    requireSameRows(h.sets, "heldout");
    writeEvaluation(
      join(opts.experiment, "heldout"),
      evaluate(h.truth, h.sets, { points: G2_POINTS, curveStep: 60 }),
    );
    for (const n of h.notes) notes.add(n);
  } else if (opts.split === "test") {
    notes.add(
      rescore === undefined
        ? "held-out split not scored (--skip-heldout)"
        : `held-out split not scored: a re-score scores only its fresh test split (the held-out split was reported with ${rescore.of})`,
    );
  }

  const id = opts.experiment.split("/").filter(Boolean).at(-1) ?? "experiment";
  const splits =
    opts.split === "test"
      ? ["train", "test", ...(scoreHeldout ? ["heldout"] : [])]
      : ["train", "validation"];
  const datasets = splits.map((s) => {
    const path = join(opts.data, `${s}.f32pack`);
    return { path, header: readDataset(path).header };
  });
  const truth = join(opts.data, `${opts.split}.f32pack`);
  const ids = carried.ids;
  writeManifest(
    opts.experiment,
    makeManifest(
      id,
      datasets,
      [
        {
          name: NAIVE,
          settings: { fitted_on: "train", mode: "per_timestep", means: naive.per_timestep },
        },
        {
          name: CLASSICAL,
          settings: { method: "levenberg-marquardt", mode: "per_timestep", grid_every: 6 },
        },
        ...carried.models.map((m) => ({
          name: m.manifest.id,
          settings: {
            manifest: `models/${m.manifest.id}/manifest.json`,
            weights_digest: m.manifest.weights_digest,
            config: m.manifest.config,
          },
        })),
        ...(decision === undefined
          ? []
          : [
              {
                name: "decision",
                settings: {
                  path: opts.decision,
                  sha256: fileDigest(opts.decision ?? ""),
                  record: decision,
                },
              },
            ]),
      ],
      [
        opts.commandLine,
        `# equivalent: tma-eval --truth ${truth} --pred <naive, classical, models> --experiment ${opts.experiment} --points ${G2_POINTS.join(",")} --bootstrap ${String(resamples)} --compare-to ${COMPARE_TO}`,
        `# equivalent: tma-gate g2 --experiment ${opts.experiment} --instantaneous ${ids.instantaneous} --time-late ${ids.timeLate} --causal-control ${ids.causalControl} --mlp-control ${ids.mlpControl} --shuffled ${ids.shuffled}${opts.split === "test" ? "" : ` (written to ${DIAGNOSTIC_FILE})`}`,
        ...(rescore?.notes ?? []).map((n) => `# ${n}`),
        ...Array.from(notes, (n) => `# ${n}`),
        ...planLines.map((l) => `# plan ${String(opts.plan)}: ${l}`),
      ],
    ),
  );
  // Last: a verdict.json (or diagnostic.json) means every output of the run is on disk.
  gate.write();
  return gate.verdict;
}
