// tma-g6 (spec 017; SRD Annex C §C.12): manoeuvre detection, a detector from frozen models
// against a CUSUM on the reference IMM's innovations, at matched false-alarm rates.
// - Validation (any split but test): every `--learned` and `--cusum` detection file is calibrated
//   to `G6_FA_PER_HOUR` on quiet rows. The best of each kind (smallest median delay, then the
//   larger detected-within-5-min rate) is compared by the G6 checks. Writes calibration.json and
//   diagnostic.json; nothing is gated.
// - Test (the gate): one `--learned` and one `--cusum` file, at the thresholds the committed
//   decision freezes. Every binding must hold:
//   - the decision names the seed, plans, detectors and thresholds;
//   - the data come from a clean tree at or after the decision;
//   - the frozen network matches `model_digests`, and the learned file's inputs are the
//     `--also` files, byte for byte, the network's naming the bound weights;
//   - a seeded 200-scenario sample of both detectors is re-computed from their names and inputs;
//   - no other experiment has scored this decision and seed (spec 015).
//   Writes verdict.json and scoring.json (exit 3 unless pass).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  courseRateDetect,
  cusumDetect,
  disagreementDetect,
  fileDigest,
  immPredict,
  parseCourseRateName,
  parseCusumName,
  parseImmName,
} from "@tma/classical";
import { isMain, readDataset, runCli, UsageError } from "@tma/data";
import {
  ChangeDecision,
  type Detection,
  type GateScoring,
  parseRecord,
  type Prediction,
  type Scenario,
} from "@tma/types";
import { defaultDeps } from "./cli-g4.js";
import {
  type G5BindingDeps,
  priorGateScorings,
  repoTop,
  requireFrozenModels,
  requireScoredOnce,
} from "./cli-g5.js";
import { type DetectionSet, readDetectionSet } from "./detection-file.js";
import type { PredictionSet } from "./evaluate.js";
import { prettyJson } from "./experiment.js";
import {
  calibrateThreshold,
  DETECT_WITHIN_S,
  detectorOutcome,
  G6_FA_PER_HOUR,
  g6Checks,
  g6Events,
  g6Verdict,
} from "./gate-g6.js";
import { openPredictionSet, scenarioSource } from "./prediction-file.js";
import { digestCache, RECOMPUTE_SCENARIOS, sampleScenarios } from "./recompute.js";

const USAGE =
  "usage: tma-g6 --truth <split.f32pack> --learned <scores.ndjson>... --cusum <scores.ndjson>... --experiment <dir> " +
  "[--also <pred.ndjson>... --decision <decision.json> --plan <plan.json>... --model <model dir>... [--repeat-of <earlier experiment>]] (bindings required on a test split; one --learned and one --cusum there)";

const finite = (v: number): number | null => (Number.isFinite(v) ? v : null);

/** Median delay, detected-within-5-min rate and false-alarm rate of one detector at threshold h. */
function summary(truth: Scenario[], set: DetectionSet, h: number) {
  const { events, scenarios } = g6Events(truth);
  const o = detectorOutcome(events, scenarios, set.byIndex, h);
  const sorted = Array.from(o.delays).sort((a, b) => a - b);
  const median = sorted[Math.floor((sorted.length - 1) / 2)] ?? Infinity;
  const hours = o.hours.reduce((t, x) => t + x, 0);
  return {
    detector: set.detector,
    threshold: h,
    events: events.length,
    median_delay_s: finite(median),
    detected_within_5min: o.delays.filter((d) => d <= DETECT_WITHIN_S).length / o.delays.length,
    missed: o.delays.filter((d) => !Number.isFinite(d)).length / o.delays.length,
    false_alarms_per_hour: o.onsets.reduce((t, x) => t + x, 0) / hours,
    quiet_hours: hours,
  };
}

type Summary = ReturnType<typeof summary>;
const better = (a: Summary, b: Summary): boolean =>
  (a.median_delay_s ?? Infinity) < (b.median_delay_s ?? Infinity) ||
  ((a.median_delay_s ?? Infinity) === (b.median_delay_s ?? Infinity) &&
    a.detected_within_5min > b.detected_within_5min);

/** A detection set's scores equal `d`'s at every row (the re-computed sample). */
function sameScores(set: DetectionSet, d: Detection): boolean {
  const s = set.byIndex.get(d.scenario_index);
  if (s === undefined || s.t.length !== d.rows.length) return false;
  return d.rows.every((r, j) => s.t[j] === r.timestamp_s && s.score[j] === Math.fround(r.score));
}

export interface G6Binding {
  decisionPath: string;
  planPaths: string[];
  modelDirs: string[];
  truthPath: string;
  learned: DetectionSet;
  cusum: DetectionSet;
}

/**
 * The bindings of a G6 test split that need no scores: the committed decision, its seed, plans,
 * detectors and thresholds, clean data at or after it, and its frozen models. Returns the
 * decision and the two thresholds.
 */
export function requireG6Binding(
  b: G6Binding,
  deps: G5BindingDeps = defaultDeps,
): { decision: ChangeDecision; learned: number; cusum: number } {
  if (!deps.isCommitted(b.decisionPath))
    throw new UsageError(`${b.decisionPath}: the decision must be committed before G6 is scored`);
  const d = parseRecord(
    ChangeDecision,
    JSON.parse(readFileSync(b.decisionPath, "utf8")),
    b.decisionPath,
    1,
  );
  const h = (deps.truthHeader ?? ((p: string) => readDataset(p).header))(b.truthPath);
  if (d.test_seed == null || d.test_seed !== h.dataset_seed)
    throw new UsageError(
      `${b.decisionPath} commits to test seed ${String(d.test_seed)}, the test data are seed ${h.dataset_seed}`,
    );
  if (h.generator_git_dirty !== false)
    throw new UsageError(`${b.truthPath}: generated from a dirty tree (or provenance unknown)`);
  if (h.generator_git_commit == null || !deps.precedes(b.decisionPath, h.generator_git_commit))
    throw new UsageError(
      `${b.truthPath}: generated at commit ${String(h.generator_git_commit)}, which does not descend from the commit that added ${b.decisionPath}`,
    );
  const plans = d.plans ?? [];
  if (
    plans.length === 0 ||
    plans.length !== b.planPaths.length ||
    !plans.every((p) => b.planPaths.includes(p))
  )
    throw new UsageError(
      `${b.decisionPath} names plans ${plans.join(", ")}, not ${b.planPaths.join(", ")}`,
    );
  for (const p of b.planPaths) deps.checkDigests(p, dirname(b.truthPath));
  if (d.reference_estimator !== b.cusum.detector)
    throw new UsageError(
      `${b.decisionPath} freezes reference detector ${String(d.reference_estimator)}, the CUSUM file is ${b.cusum.detector}`,
    );
  const carried = d.carried_models ?? [];
  if (carried.length !== 1 || carried[0] !== b.learned.detector)
    throw new UsageError(
      `${b.decisionPath} carries ${carried.join(", ")}, the learned file is ${b.learned.detector}`,
    );
  const th = new Map((d.detector_thresholds ?? []).map((x) => [x.detector, x.threshold]));
  const lt = th.get(b.learned.detector);
  const ct = th.get(b.cusum.detector);
  if (lt === undefined || ct === undefined)
    throw new UsageError(
      `${b.decisionPath} freezes no threshold for ${lt === undefined ? b.learned.detector : b.cusum.detector}`,
    );
  if ((d.model_digests ?? []).length === 0)
    throw new UsageError(
      `${b.decisionPath}: a G6 decision binds its frozen network by model_digests`,
    );
  requireFrozenModels(d, b.modelDirs, b.decisionPath);
  return { decision: d, learned: lt, cusum: ct };
}

/**
 * The learned file's inputs are among `also`, byte for byte; its network input names one of the
 * bound weights. Each detector's sampled scenarios re-compute to the stored scores: CUSUM from its
 * name, the learned detector from the stored network rows and the tracker re-run from its name.
 */
export function requireDetectionChain(
  learned: DetectionSet,
  cusum: DetectionSet,
  also: PredictionSet[],
  modelDirs: string[],
  truth: Scenario[],
): number[] {
  const digestOf = digestCache();
  const weights = new Set(modelDirs.map((dir) => fileDigest(join(dir, "weights.bin"))));
  const inputs = learned.header.inputs ?? [];
  const resolved = inputs.map((i) => {
    const m = also.find((a) => a.estimator === i.estimator && digestOf(a) === i.sha256);
    if (m === undefined)
      throw new UsageError(
        `${learned.path}: input ${i.estimator} (SHA-256 ${i.sha256}) is not among the --also files`,
      );
    return m;
  });
  const network = resolved[0];
  if (network === undefined) throw new UsageError(`${learned.path}: names no input files`);
  const w = network.header?.model_weights_sha256;
  if (w == null || !weights.has(w))
    throw new UsageError(`${network.path ?? network.label}: not made with a --model's weights`);
  const cs = parseCusumName(cusum.detector);
  if (cs === null)
    throw new UsageError(`${cusum.path}: ${cusum.detector} is not a canonical CUSUM name`);
  const netRows = (s: Scenario): Prediction => {
    const p = network.byIndex.get(s.metadata.index);
    if (p === undefined)
      throw new UsageError(
        `${network.path ?? network.label}: no scenario ${String(s.metadata.index)}`,
      );
    return p;
  };
  let remake: (s: Scenario) => Detection;
  const tracker = resolved[1];
  if (tracker !== undefined) {
    const ip = parseImmName(tracker.estimator);
    if (ip === null)
      throw new UsageError(
        `${tracker.path ?? tracker.label}: ${tracker.estimator} is not a canonical IMM name`,
      );
    remake = (s) => disagreementDetect(netRows(s), immPredict(s, ip));
  } else {
    const win = parseCourseRateName(learned.detector, network.estimator);
    if (win === null)
      throw new UsageError(
        `${learned.path}: ${learned.detector} declares no detector the gate can re-compute`,
      );
    remake = (s) => courseRateDetect(netRows(s), win);
  }
  const byIndex = new Map(truth.map((s) => [s.metadata.index, s]));
  const { scenarios } = g6Events(truth);
  const sample = sampleScenarios(
    scenarios.map(({ s }) => s.metadata.index),
    RECOMPUTE_SCENARIOS,
  );
  for (const idx of sample) {
    const s = byIndex.get(idx);
    if (s === undefined) continue;
    const want = remake(s);
    if (want.detector !== learned.detector || !sameScores(learned, want))
      throw new UsageError(
        `${learned.path}: scenario ${String(idx)} differs from ${learned.detector} re-computed from its inputs`,
      );
    if (!sameScores(cusum, cusumDetect(s, cs.imm, cs.cusum)))
      throw new UsageError(
        `${cusum.path}: scenario ${String(idx)} differs from ${cusum.detector} re-computed from its name`,
      );
  }
  return sample;
}

export function main(argv: string[]): unknown {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      truth: { type: "string" },
      learned: { type: "string", multiple: true },
      cusum: { type: "string", multiple: true },
      also: { type: "string", multiple: true },
      experiment: { type: "string" },
      decision: { type: "string" },
      plan: { type: "string", multiple: true },
      model: { type: "string", multiple: true },
      "repeat-of": { type: "string" },
    },
  });
  const { truth, experiment } = values;
  const learnedPaths = values.learned ?? [];
  const cusumPaths = values.cusum ?? [];
  if (!truth || !experiment || learnedPaths.length === 0 || cusumPaths.length === 0)
    throw new UsageError(USAGE);
  const gate = readDataset(truth).header.split === "test";
  const out = join(experiment, gate ? "verdict.json" : "diagnostic.json");
  if (existsSync(out)) throw new UsageError(`${out} exists: a G6 split is scored once`);
  const learned = learnedPaths.map((p) => readDetectionSet(p, truth));
  const cusum = cusumPaths.map((p) => readDetectionSet(p, truth));
  const scenarios = Array.from(scenarioSource(truth));
  if (!gate) {
    if (values.decision || values["repeat-of"])
      throw new UsageError("--decision and --repeat-of apply to a test split only");
    const { scenarios: g6s } = g6Events(scenarios);
    const cal = (set: DetectionSet) =>
      summary(scenarios, set, calibrateThreshold(g6s, set.byIndex).threshold);
    const ls = learned.map(cal);
    const cs = cusum.map(cal);
    const pick = (xs: Summary[]): number =>
      xs.reduce((bi, x, i, a) => (better(x, a[bi] ?? x) ? i : bi), 0);
    const li = pick(ls);
    const ci = pick(cs);
    const bl = ls[li];
    const bc = cs[ci];
    const lset = learned[li];
    const cset = cusum[ci];
    if (!bl || !bc || !lset || !cset) throw new Error("G6: nothing to compare");
    const judged = g6Verdict(
      g6Checks(
        scenarios,
        { label: lset.detector, scores: lset.byIndex, threshold: bl.threshold },
        { label: cset.detector, scores: cset.byIndex, threshold: bc.threshold },
      ),
    );
    mkdirSync(experiment, { recursive: true });
    writeFileSync(
      join(experiment, "calibration.json"),
      prettyJson({
        target_false_alarms_per_hour: G6_FA_PER_HOUR,
        learned: ls,
        cusum: cs,
        chosen: { learned: bl.detector, cusum: bc.detector },
      }),
    );
    const verdict = {
      ...judged,
      decided_by: "validation diagnostic (spec 017): not a gate decision",
    };
    writeFileSync(out, prettyJson(verdict));
    return {
      experiment,
      chosen: { learned: bl, cusum: bc },
      checks: verdict.checks.map((k) => `${k.name}: ${k.result}`),
    };
  }
  if (learned.length !== 1 || cusum.length !== 1)
    throw new UsageError(`a test split takes one --learned and one --cusum\n${USAGE}`);
  if (!values.decision || !values.plan?.length || !values.model?.length)
    throw new UsageError(`a test split needs --decision, --plan and --model\n${USAGE}`);
  const [l, c] = [learned[0], cusum[0]];
  if (!l || !c) throw new UsageError(USAGE);
  const bound = requireG6Binding({
    decisionPath: values.decision,
    planPaths: values.plan,
    modelDirs: values.model,
    truthPath: truth,
    learned: l,
    cusum: c,
  });
  const also = (values.also ?? []).map((p) => openPredictionSet(p, truth));
  const top = repoTop();
  const current = {
    decision: relative(top, resolve(values.decision)),
    decision_sha256: fileDigest(values.decision),
    test_seed: String(bound.decision.test_seed),
  };
  const repeatOf = requireScoredOnce(
    priorGateScorings(join(top, "experiments"), "G6"),
    current,
    experiment,
    values["repeat-of"],
    top,
    "G6",
  );
  const sample = requireDetectionChain(l, c, also, values.model, scenarios);
  const sampleSha = createHash("sha256").update(sample.join(",")).digest("hex");
  const verdict = g6Verdict(
    g6Checks(
      scenarios,
      { label: l.detector, scores: l.byIndex, threshold: bound.learned },
      { label: c.detector, scores: c.byIndex, threshold: bound.cusum },
    ),
  );
  const scoring: GateScoring = {
    gate: "G6",
    ...current,
    truth_sha256: fileDigest(truth),
    recomputed: [l.detector, c.detector].map((detector) => ({
      estimator: detector,
      scenarios: sample.length,
      sample_sha256: sampleSha,
    })),
    ...(repeatOf === undefined ? {} : { repeat_of: repeatOf }),
  };
  mkdirSync(experiment, { recursive: true });
  writeFileSync(out, prettyJson(verdict));
  writeFileSync(join(experiment, "scoring.json"), prettyJson(scoring));
  if (verdict.result !== "pass") process.exitCode = 3;
  return {
    experiment,
    gate: "G6",
    result: verdict.result,
    checks: verdict.checks.map((k) => `${k.name}: ${k.result}`),
  };
}

if (isMain(import.meta.url)) {
  const code = runCli(main, process.argv.slice(2));
  if (code !== 0) process.exitCode = code;
}
