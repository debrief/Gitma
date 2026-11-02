// tma-g5 (spec 012 FR-005; SRD Annex C §C.5): G5 for one or two learned trackers against the
// frozen reference on one split (gate-g5.ts). On a validation split it writes diagnostic.json and
// report.json: every estimator given (trackers, reference, --also files: the other reference,
// batch least squares, naive) on the G5 rows, medians and P90s overall, settled and unsettled, by
// gate time and by manoeuvre mix (FR-006). On a test split (the gate) every binding of
// `requireG5Binding` must hold, and it writes verdict.json (exit 3 unless pass).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileDigest } from "@tma/classical";
import { isMain, readDataset, runCli, UsageError } from "@tma/data";
import {
  ChangeDecision,
  type DatasetHeader,
  type GateRecomputation,
  GateScoring,
  GateVerdict,
  parseRecord,
  type Scenario,
} from "@tma/types";
import { defaultDeps, type G4BindingDeps } from "./cli-g4.js";
import { selectQuantile } from "./bootstrap.js";
import { rowError } from "./errors.js";
import type { PredictionSet } from "./evaluate.js";
import { prettyJson } from "./experiment.js";
import { G5_GATE_MIN, type G5Row, g5Checks, g5Rows, g5Verdict } from "./gate-g5.js";
import { openPredictionSet, scenarioSource } from "./prediction-file.js";
import { type DigestOf, digestCache, requireRecomputed, sampleScenarios } from "./recompute.js";
import { manoeuvreBand } from "./slices.js";

const USAGE =
  "usage: tma-g5 --truth <split.f32pack> --tracker <pred.ndjson> [--tracker <pred.ndjson>] --reference <pred.ndjson> [--also <pred.ndjson>]... --experiment <dir> [--decision <decision.json> (--plan <plan.json> --model <model dir>)... [--repeat-of <earlier experiment>]] (bindings required on a test split)";

export interface G5Binding {
  decisionPath: string;
  planPaths: string[];
  modelDirs: string[];
  truthPath: string;
  trackers: string[];
  reference: string;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const sb = [...b].sort();
  return a.length === b.length && [...a].sort().every((x, i) => x === sb[i]);
};

/**
 * Every binding a G5 test split needs (spec 012 FR-005, as G4's): the decision is committed; it
 * names this test seed, these plans (whose digests the data must match), this reference and these
 * carried trackers; the data come from a clean tree; and every carried tracker was trained after
 * the decision was committed. A decision with `model_digests` (spec 013: a hybrid of frozen
 * models) binds the models by file digest in place of training ancestry: the --model directories
 * must be exactly those models, byte for byte, and the carried trackers are the estimators the
 * decision names. On every path the test data must have been generated at the commit that added
 * the decision or a descendant of it (spec 015 FR-002). Returns the decision, or throws naming
 * the first failure.
 */
export interface G5BindingDeps extends G4BindingDeps {
  /** The test split's header (default: read from the file; injected in tests). */
  truthHeader?: (path: string) => DatasetHeader;
}

export function requireG5Binding(b: G5Binding, deps: G5BindingDeps = defaultDeps): ChangeDecision {
  if (!deps.isCommitted(b.decisionPath))
    throw new UsageError(`${b.decisionPath}: the decision must be committed before G5 is scored`);
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
  // The data postdate the decision (spec 015 FR-002), on every path, frozen models included.
  if (h.generator_git_commit == null || !deps.precedes(b.decisionPath, h.generator_git_commit))
    throw new UsageError(
      `${b.truthPath}: generated at commit ${String(h.generator_git_commit)}, which does not descend from the commit that added ${b.decisionPath}`,
    );
  const plans = d.plans ?? [];
  if (plans.length === 0 || !sameSet(plans, b.planPaths))
    throw new UsageError(
      `${b.decisionPath} names plans ${plans.join(", ")}, not ${b.planPaths.join(", ")}`,
    );
  for (const p of b.planPaths) deps.checkDigests(p, dirname(b.truthPath));
  if (d.reference_estimator == null || d.reference_estimator !== b.reference)
    throw new UsageError(
      `${b.decisionPath} freezes reference ${String(d.reference_estimator)}, the reference predictions are ${b.reference}`,
    );
  const carried = d.carried_models ?? [];
  if (carried.length === 0 || !sameSet(carried, b.trackers))
    throw new UsageError(
      `${b.decisionPath} carries ${carried.join(", ")}, the tracker predictions are ${b.trackers.join(", ")}`,
    );
  if ((d.model_digests ?? []).length > 0) {
    requireFrozenModels(d, b.modelDirs, b.decisionPath);
    return d;
  }
  const ids = b.modelDirs.map((dir) => {
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
      id?: string;
      git_commit?: string;
    };
    if (typeof m.git_commit !== "string" || !deps.precedes(b.decisionPath, m.git_commit))
      throw new UsageError(
        `the decision was not committed before ${String(m.id)} was trained (commit ${String(m.git_commit)})`,
      );
    return String(m.id);
  });
  if (!sameSet(ids, b.trackers))
    throw new UsageError(
      `--model directories hold ${ids.join(", ")}, not ${b.trackers.join(", ")}`,
    );
  return d;
}

/** The --model directories are exactly the decision's `model_digests`, file for file. */
export function requireFrozenModels(
  d: ChangeDecision,
  modelDirs: string[],
  decisionPath: string,
): void {
  const digests = d.model_digests ?? [];
  const byId = new Map(digests.map((m) => [m.model, m]));
  if (byId.size !== digests.length)
    throw new UsageError(`${decisionPath}: model_digests names a model twice`);
  const ids = modelDirs.map((dir) => {
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { id?: string };
    const id = String(m.id);
    const want = byId.get(id);
    if (want === undefined)
      throw new UsageError(`${dir}: model ${id} is not in ${decisionPath} model_digests`);
    const files: [string, string][] = [
      ["weights.bin", want.weights_sha256],
      ["manifest.json", want.manifest_sha256],
      ["model.json", want.model_json_sha256],
    ];
    for (const [f, sha] of files)
      if (fileDigest(join(dir, f)) !== sha)
        throw new UsageError(`${join(dir, f)}: SHA-256 differs from ${decisionPath} model_digests`);
    return id;
  });
  if (!sameSet(ids, [...byId.keys()]))
    throw new UsageError(
      `--model directories hold ${ids.join(", ")}, ${decisionPath} freezes ${[...byId.keys()].join(", ")}`,
    );
}

/**
 * Every carried tracker's predictions trace to a bound model (schema 0.17.0): its file names the
 * weights it was made with (`model_weights_sha256`, one of the --model directories' weights.bin),
 * or it names its input files (`inputs`, e.g. a hybrid), each of which must be one of the files
 * given to tma-g5, byte for byte, and one of which must name bound weights. Closes the gap where a
 * prediction file was accepted on the estimator name in its own header.
 */
export function requirePredictionChain(
  trackers: PredictionSet[],
  others: PredictionSet[],
  modelDirs: string[],
  digestOf: DigestOf = digestCache(),
): void {
  const weights = new Set(modelDirs.map((dir) => fileDigest(join(dir, "weights.bin"))));
  for (const t of trackers) {
    const h = t.header;
    const where = t.path ?? t.label;
    if (h?.model_weights_sha256 != null) {
      if (!weights.has(h.model_weights_sha256))
        throw new UsageError(
          `${where}: made with weights ${h.model_weights_sha256}, not a --model's`,
        );
      continue;
    }
    const inputs = h?.inputs ?? [];
    if (inputs.length === 0)
      throw new UsageError(
        `${where}: names neither its model's weights nor its inputs (prediction files from schema 0.17.0 do)`,
      );
    let bound = false;
    for (const input of inputs) {
      const match = others.find(
        (o) => o.estimator === input.estimator && digestOf(o) === input.sha256,
      );
      if (match === undefined)
        throw new UsageError(
          `${where}: input ${input.estimator} (SHA-256 ${input.sha256}) is not among the files given to tma-g5`,
        );
      const w = match.header?.model_weights_sha256;
      if (w != null && weights.has(w)) bound = true;
    }
    if (!bound)
      throw new UsageError(`${where}: none of its inputs was made with a --model's weights`);
  }
}

/** A G5 scoring already recorded under the experiments root. */
interface PriorScoring {
  dir: string;
  scoring: GateScoring | null;
}

/** Every experiment under `root` holding a G5 verdict, with its scoring.json if it has one. */
export function priorG5Scorings(root: string): PriorScoring[] {
  if (!existsSync(root)) return [];
  const out: PriorScoring[] = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = join(root, e.name);
    const v = join(dir, "verdict.json");
    if (!existsSync(v)) continue;
    const verdict = parseRecord(GateVerdict, JSON.parse(readFileSync(v, "utf8")), v, 1);
    if (verdict.gate !== "G5") continue;
    const sp = join(dir, "scoring.json");
    out.push({
      dir,
      scoring: existsSync(sp)
        ? parseRecord(GateScoring, JSON.parse(readFileSync(sp, "utf8")), sp, 1)
        : null,
    });
  }
  return out;
}

/**
 * "Scored once" across experiments (spec 015 FR-003): refuses when another experiment under
 * `root` already records a G5 verdict for this decision (same path or same SHA-256) and test seed,
 * unless `repeatOf` names that experiment. A G5 verdict without scoring.json cannot be told apart,
 * so it refuses too. Returns the earlier experiment's path relative to `repoRoot`, or undefined.
 */
export function requireScoredOnce(
  prior: readonly PriorScoring[],
  current: Pick<GateScoring, "decision" | "decision_sha256" | "test_seed">,
  experiment: string,
  repeatOf: string | undefined,
  repoRoot: string,
): string | undefined {
  const rel = (p: string): string => relative(repoRoot, resolve(p));
  const self = rel(experiment);
  const want = repeatOf === undefined ? undefined : rel(repeatOf);
  const same = prior.filter((p) => rel(p.dir) !== self);
  for (const p of same)
    if (p.scoring === null && rel(p.dir) !== want)
      throw new UsageError(
        `${p.dir} holds a G5 verdict without scoring.json: cannot tell what it scored (name it with --repeat-of if it is this decision and seed)`,
      );
  const matches = same.filter(
    (p) =>
      p.scoring !== null &&
      p.scoring.test_seed === current.test_seed &&
      (p.scoring.decision === current.decision ||
        p.scoring.decision_sha256 === current.decision_sha256),
  );
  if (want === undefined) {
    const m = matches[0];
    if (m !== undefined)
      throw new UsageError(
        `${m.dir} already records G5 for ${current.decision} on test seed ${current.test_seed}: a G5 test split is scored once (a reproduction names it with --repeat-of)`,
      );
    return undefined;
  }
  if (want === self) throw new UsageError("--repeat-of names the output experiment itself");
  if (!matches.some((m) => rel(m.dir) === want))
    throw new UsageError(
      `--repeat-of ${repeatOf}: no G5 scoring of ${current.decision} on test seed ${current.test_seed} is recorded there`,
    );
  return want;
}

/** The repository's top level (the experiments root is its experiments/ folder). */
function repoTop(): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    return process.cwd();
  }
}

interface Summary {
  estimator: string;
  rows: string;
  metric: string;
  n: number;
  median: number | null;
  p90: number | null;
  non_converged: number;
}

/** A target manoeuvre has ended at or before this row. */
export function afterManoeuvre(r: G5Row): boolean {
  return (r.s.metadata.manoeuvres ?? []).some((m) => m.end_index <= r.k);
}

/** Medians and P90s of every set on the G5 rows and their slices (FR-006). */
export function g5Report(truth: Scenario[], sets: PredictionSet[]): Summary[] {
  const all = g5Rows(truth);
  const groups: [string, G5Row[]][] = [
    ["all G5 rows", all],
    ["settled", all.filter((r) => r.settled)],
    ["not settled", all.filter((r) => !r.settled)],
    // Reported, not gated: the pooled settled check averages two regimes (spec 013 panel round 1).
    ["settled, before any manoeuvre", all.filter((r) => r.settled && !afterManoeuvre(r))],
    ["settled, after a manoeuvre", all.filter((r) => r.settled && afterManoeuvre(r))],
    ...G5_GATE_MIN.map((t): [string, G5Row[]] => [
      `zig+${String(t)}min`,
      all.filter((r) => r.minutes === t),
    ]),
    ...G5_GATE_MIN.map((t): [string, G5Row[]] => [
      `settled, zig+${String(t)}min`,
      all.filter((r) => r.settled && r.minutes === t),
    ]),
  ];
  for (const band of [...new Set(all.map((r) => manoeuvreBand(r.s.metadata)))].sort())
    groups.push([`manoeuvre=${band}`, all.filter((r) => manoeuvreBand(r.s.metadata) === band)]);
  const finite = (v: number): number | null => (Number.isFinite(v) ? v : null);
  const out: Summary[] = [];
  for (const set of sets)
    for (const [label, rows] of groups)
      for (const metric of ["range_rel", "course_deg", "speed_kt"] as const) {
        let nc = 0;
        const xs = rows.map(({ s, k }) => {
          const p = set.byIndex.get(s.metadata.index);
          const dt = s.metadata.parameters.dt_s;
          const r = p?.rows.find((x) => Math.round(x.timestamp_s / dt) === k);
          if (r === undefined || !r.converged) {
            nc++;
            return Infinity;
          }
          return rowError(s, r)[metric];
        });
        out.push({
          estimator: set.label,
          rows: label,
          metric,
          n: xs.length,
          median: xs.length ? finite(selectQuantile(Float64Array.from(xs), 0.5)) : null,
          p90: xs.length ? finite(selectQuantile(Float64Array.from(xs), 0.9)) : null,
          non_converged: nc,
        });
      }
  return out;
}

export function main(argv: string[]): unknown {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      truth: { type: "string" },
      tracker: { type: "string", multiple: true },
      reference: { type: "string" },
      also: { type: "string", multiple: true },
      experiment: { type: "string" },
      decision: { type: "string" },
      plan: { type: "string", multiple: true },
      model: { type: "string", multiple: true },
      "repeat-of": { type: "string" },
    },
  });
  const { truth, reference, experiment } = values;
  const trackers = values.tracker ?? [];
  if (!truth || !reference || !experiment || trackers.length < 1 || trackers.length > 2)
    throw new UsageError(USAGE);
  const sets = trackers.map((p) => openPredictionSet(p, truth));
  const ref = openPredictionSet(reference, truth);
  const also = (values.also ?? []).map((p) => openPredictionSet(p, truth));
  const gate = readDataset(truth).header.split === "test";
  if (!gate && values["repeat-of"] !== undefined)
    throw new UsageError("--repeat-of applies to a test split only");
  const out = join(experiment, gate ? "verdict.json" : "diagnostic.json");
  if (existsSync(out)) throw new UsageError(`${out} exists: a G5 split is scored once`);
  const digestOf = digestCache();
  let scoring: GateScoring | undefined;
  if (gate) {
    if (!values.decision || !values.plan?.length || !values.model?.length)
      throw new UsageError(`a test split needs --decision, --plan and --model\n${USAGE}`);
    const d = requireG5Binding({
      decisionPath: values.decision,
      planPaths: values.plan,
      modelDirs: values.model,
      truthPath: truth,
      trackers: sets.map((t) => t.estimator),
      reference: ref.estimator,
    });
    requirePredictionChain(sets, [ref, ...also], values.model, digestOf);
    const top = repoTop();
    const current = {
      decision: relative(top, resolve(values.decision)),
      decision_sha256: fileDigest(values.decision),
      test_seed: String(d.test_seed),
    };
    const repeatOf = requireScoredOnce(
      priorG5Scorings(join(top, "experiments")),
      current,
      experiment,
      values["repeat-of"],
      top,
    );
    scoring = {
      gate: "G5",
      ...current,
      truth_sha256: fileDigest(truth),
      ...(repeatOf === undefined ? {} : { repeat_of: repeatOf }),
    };
  }
  const scenarios = Array.from(scenarioSource(truth));
  if (scoring !== undefined) {
    // Re-compute a seeded sample of the carried trackers' and the reference's rows (FR-001).
    const sample = sampleScenarios([...new Set(g5Rows(scenarios).map((r) => r.s.metadata.index))]);
    const given = [...sets, ref, ...also];
    const recomputed = [...sets, ref]
      .map((t) => requireRecomputed(t, given, scenarios, sample, digestOf))
      .filter((r): r is GateRecomputation => r !== null);
    scoring = { ...scoring, recomputed };
  }
  const checks = sets.flatMap((t) => g5Checks(scenarios, t, ref));
  const judged = g5Verdict(
    checks,
    sets.map((t) => t.label),
  );
  const verdict = gate
    ? judged
    : { ...judged, decided_by: "validation diagnostic (spec 012 FR-005): not a gate decision" };
  mkdirSync(experiment, { recursive: true });
  writeFileSync(out, prettyJson(verdict));
  if (scoring !== undefined) writeFileSync(join(experiment, "scoring.json"), prettyJson(scoring));
  writeFileSync(
    join(experiment, "report.json"),
    prettyJson(g5Report(scenarios, [...sets, ref, ...also])),
  );
  if (gate && verdict.result !== "pass") process.exitCode = 3;
  return {
    experiment,
    gate: verdict.gate,
    result: verdict.result,
    checks: verdict.checks.map((k) => `${k.name}: ${k.result}`),
    ...(scoring === undefined
      ? {}
      : {
          recomputed: (scoring.recomputed ?? []).map(
            (r) => `${r.estimator}: ${String(r.scenarios)} scenarios byte-identical`,
          ),
          ...(scoring.repeat_of === undefined ? {} : { repeat_of: scoring.repeat_of }),
        }),
  };
}

if (isMain(import.meta.url)) {
  const code = runCli(main, process.argv.slice(2));
  if (code !== 0) process.exitCode = code;
}
