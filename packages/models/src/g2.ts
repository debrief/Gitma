// One-command G2 run (spec 003 T038, contracts/cli.md `tma-g2`): naive and classical per-timestep,
// every trained model's predictions, then the library equivalent of
//   tma-eval --points 300,600 --bootstrap 2000 --compare-to classical:per_timestep
//   tma-gate g2
// on one split. `--split validation` is the phase diagnostic (research R5): it reads only the train
// and validation splits and writes `diagnostic.json`, never `verdict.json`, so a validation result
// cannot be mistaken for the gate. `--split test` is the G2 decision: when a phase B exists it needs
// a committed decision record (SC-005), and it also scores the held-out split (FR-019).
// Lives here rather than in @tma/eval so tfjs-node stays out of the evaluation package.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLASSICAL,
  classicalPredict,
  fileDigest,
  fitNaive,
  NAIVE,
  naivePredict,
} from "@tma/classical";
import { readDataset } from "@tma/data";
import {
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  bootstrapEvaluation,
  compareOnCommonRows,
  evaluate,
  type G1Ids,
  g2Checks,
  g2Verdict,
  loadPredictionSet,
  makeManifest,
  type PredictionSet,
  perTimestep,
  prettyJson,
  writeBootstrap,
  writeComparison,
  writeEvaluation,
  writeManifest,
  writeVerdict,
} from "@tma/eval";
import { openFeatures } from "@tma/features";
import {
  ChangeDecision,
  type FeatureSet,
  type GateVerdict,
  type NaiveModel,
  parseRecord,
  type Prediction,
  RecordError,
  type Scenario,
} from "@tma/types";
import { findModels, predictionSet, writePredictions } from "./g1.js";
import { readModelManifest } from "./manifest-io.js";
import {
  loadModel,
  predictScenarios,
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

/**
 * Every estimator must predict the same rows (scenario and timestamp) as naive, so the gate's
 * same-sample check compares the same rows, not only the same counts (G2 panel R19).
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
    for (const [idx, p] of ref.byIndex) {
      if (key(set.byIndex.get(idx)) !== key(p)) {
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
  const iteration = /(?:^|\/)configs\/iter(\d+)\//.exec(normPath(opts.plan ?? ""));
  const bound = iteration !== null && Number(iteration[1]) >= 3;
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
  if (bound && (d.plan == null || normPath(d.plan) !== normPath(opts.plan ?? ""))) {
    throw new RecordError(
      opts.decision,
      "plan",
      `the decision pre-registers ${d.plan ?? "no plan"}, not ${String(opts.plan)}`,
    );
  }
  if (d.test_seed != null && opts.plan !== undefined) {
    const p = JSON.parse(readFileSync(opts.plan, "utf8")) as {
      dataset?: { seed?: string; fresh_test?: { seed?: string } };
    };
    const seed = p.dataset?.fresh_test?.seed ?? p.dataset?.seed;
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
  scenarios: Scenario[];
  sets: PredictionSet[];
  notes: string[];
}

export interface ModelSet {
  ids: G1Ids;
  models: { dir: string; manifest: ReturnType<typeof readModelManifest> }[];
}

/**
 * Naive, classical (cached per split) and every model of each set, on one split. Model
 * predictions go to `predictions/<split>.<tag.><model id>.ndjson`; the other phase passes a tag
 * so its files never overwrite the carried set's (same model ids).
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
  const scenarios: Scenario[] = [...readDataset(truthPath).scenarios()];
  const sets: PredictionSet[] = [
    predictionSet(
      NAIVE,
      scenarios.map((s) => naivePredict(s, naive, "per_timestep")),
    ),
  ];
  const predDir = join(opts.data, "predictions");
  mkdirSync(predDir, { recursive: true });
  const classicalPath = join(predDir, `${split}.classical.ndjson`);
  if (existsSync(classicalPath)) {
    log(`${split}: reusing ${classicalPath}`);
    sets.push(loadPredictionSet(classicalPath, truthPath));
  } else {
    log(`${split}: classical per-timestep on ${String(scenarios.length)} scenarios`);
    const ps = scenarios.map((s) => classicalPredict(s, "per_timestep"));
    writePredictions(classicalPath, CLASSICAL, truthPath, ps);
    sets.push(predictionSet(CLASSICAL, ps));
  }
  const notes: string[] = [];
  for (const g of groups) {
    for (const m of g.models) {
      const fs = m.manifest.config.feature_set ?? "raw";
      const path = featuresPath(opts.data, split, fs);
      const features = openFeatures(path);
      try {
        log(`${split}: predicting ${m.manifest.id} (${fs}, ${path})`);
        requireSameFeatureSet(features, m.manifest.config.feature_set, m.manifest.id);
        const note = requireSameNormalisation(features, m.manifest.normalisation, m.manifest.id, {
          header: trainHeader,
          modelSchemaVersion: m.manifest.schema_version,
          modelSourceHeader: m.manifest.source_dataset_header,
        });
        if (note !== undefined) notes.push(note);
        const model = await loadModel(m.dir);
        const ps = predictScenarios(
          model,
          features,
          scenarios,
          m.manifest.normalisation,
          m.manifest.id,
        );
        model.dispose();
        writePredictions(
          join(predDir, `${split}.${tag === undefined ? "" : `${tag}.`}${m.manifest.id}.ndjson`),
          m.manifest.id,
          truthPath,
          ps,
        );
        sets.push(predictionSet(m.manifest.id, ps));
      } finally {
        features.close();
      }
    }
  }
  return { scenarios, sets, notes };
}

/** tma-eval (points, bootstrap, comparison) and the G2 checks, written to `dir`. */
function evaluateInto(
  dir: string,
  scored: Scored,
  ids: G1Ids,
  resamples: number,
  verdictFile: "verdict.json" | typeof DIAGNOSTIC_FILE,
  decidedBy?: string,
): GateVerdict {
  const ev = evaluate(scored.scenarios, scored.sets, { points: G2_POINTS, curveStep: 60 });
  writeEvaluation(dir, ev);
  const report = bootstrapEvaluation(scored.scenarios, scored.sets, {
    points: G2_POINTS,
    resamples,
    seed: BOOTSTRAP_SEED,
    reference: perTimestep(NAIVE),
  });
  writeBootstrap(dir, report);
  writeComparison(dir, compareOnCommonRows(scored.scenarios, scored.sets, COMPARE_TO, G2_POINTS));
  const verdict = g2Verdict(g2Checks(ev.metrics, ev.curves, report, ids));
  if (decidedBy !== undefined) verdict.decided_by = decidedBy;
  if (verdictFile === "verdict.json") writeVerdict(dir, verdict);
  else writeFileSync(join(dir, DIAGNOSTIC_FILE), prettyJson(verdict));
  return verdict;
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

export async function runG2(opts: G2RunOptions): Promise<GateVerdict> {
  const log = opts.log ?? ((l: string) => process.stderr.write(`${l}\n`));
  const resamples = opts.resamples ?? BOOTSTRAP_RESAMPLES;
  const decision = requireDecision(opts);
  const carried: ModelSet = findModels(opts.models);
  // R19: on test, the data must be the plan's (content digests), and the decision must have been
  // committed before the carried weights were trained (not merely committed now).
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
    if (opts.decision !== undefined) {
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
  const other: ModelSet | undefined =
    opts.compareModels === undefined ? undefined : findModels(opts.compareModels);
  const trainPath = join(opts.data, "train.f32pack");
  const train = readDataset(trainPath);
  const naive = fitNaive(train.scenarios(), fileDigest(trainPath));
  const verdictFile = opts.split === "test" ? "verdict.json" : DIAGNOSTIC_FILE;
  const decidedBy = opts.split === "test" ? undefined : VALIDATION_DECIDED_BY;

  const scored = await scoreSplit(opts, opts.split, naive, train.header, [carried], log);
  requireSameRows(scored.sets, opts.split);
  const verdict = evaluateInto(
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
    );
    copyModels(dir, other);
    requireSameRows(o.sets, `${opts.split} (other phase)`);
    for (const n of o.notes) notes.add(n);
  }
  // FR-019: the held-out geometry split is scored with the gate run only (never for validation).
  if (opts.split === "test") {
    const h = await scoreSplit(opts, "heldout", naive, train.header, [carried], log);
    requireSameRows(h.sets, "heldout");
    writeEvaluation(
      join(opts.experiment, "heldout"),
      evaluate(h.scenarios, h.sets, { points: G2_POINTS, curveStep: 60 }),
    );
    for (const n of h.notes) notes.add(n);
  }

  const id = opts.experiment.split("/").filter(Boolean).at(-1) ?? "experiment";
  const splits = opts.split === "test" ? ["train", "test", "heldout"] : ["train", "validation"];
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
        ...Array.from(notes, (n) => `# ${n}`),
        ...planLines.map((l) => `# plan ${String(opts.plan)}: ${l}`),
      ],
    ),
  );
  return verdict;
}
