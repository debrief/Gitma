// tma-g4 (spec 010 FR-008, FR-009): G4 for the carried network against the frozen reference
// tracker on one split (gate-g4.ts). Writes <experiment>/verdict.json for a test split (the gate),
// diagnostic.json for any other, once each, and report.json: every estimator given (network,
// reference, --also files: the other tuned tracker, batch least squares, naive, hybrid) on the
// same G4 and control rows, medians and P90s (FR-010).
// On a test split: the committed decision must name the test seed, the reference estimator and
// the carried model; the data must match the plan's content digests and come from a clean tree;
// and the decision must have been committed before the carried model was trained.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { isMain, readDataset, runCli, UsageError } from "@tma/data";
import { ChangeDecision, parseRecord, type Scenario } from "@tma/types";
import { selectQuantile } from "./bootstrap.js";
import { rowError } from "./errors.js";
import type { PredictionSet } from "./evaluate.js";
import { prettyJson } from "./experiment.js";
import { g4Checks, g4Rows, g4Verdict } from "./gate-g4.js";
import { G2_CRITERIA } from "./gate-g2.js";
import { openPredictionSet, scenarioSource } from "./prediction-file.js";

const USAGE =
  "usage: tma-g4 --truth <split.f32pack> --network <pred.ndjson> --reference <pred.ndjson> [--also <pred.ndjson>]... --experiment <dir> [--decision <decision.json> --plan <plan.json> --model <model dir>] (all three required on a test split)";

function committed(path: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", path], { stdio: "ignore" });
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", path], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** The commit that added `path` is an ancestor of `commit`. */
function addedBefore(path: string, commit: string): boolean {
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

export interface G4Binding {
  decisionPath: string;
  planPath: string;
  modelDir: string;
  truthPath: string;
  network: string;
  reference: string;
}

export interface G4BindingDeps {
  isCommitted: (path: string) => boolean;
  checkDigests: (plan: string, dataDir: string) => void;
  precedes: (decisionPath: string, commit: string) => boolean;
}

const defaultDeps: G4BindingDeps = {
  isCommitted: committed,
  checkDigests: (plan, dataDir) => {
    try {
      execFileSync(process.execPath, ["scripts/train-plan.mjs", "check-digests", plan, dataDir], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      const err = e as { stderr?: Buffer; message: string };
      throw new UsageError(`${plan}: ${(err.stderr?.toString() ?? err.message).trim()}`);
    }
  },
  precedes: addedBefore,
};

/** Every binding a test split needs (FR-009), or a usage error naming the first that fails. */
export function requireG4Binding(b: G4Binding, deps: G4BindingDeps = defaultDeps): ChangeDecision {
  if (!deps.isCommitted(b.decisionPath))
    throw new UsageError(`${b.decisionPath}: the decision must be committed before G4 is scored`);
  const d = parseRecord(
    ChangeDecision,
    JSON.parse(readFileSync(b.decisionPath, "utf8")),
    b.decisionPath,
    1,
  );
  const h = readDataset(b.truthPath).header;
  if (d.test_seed == null || d.test_seed !== h.dataset_seed)
    throw new UsageError(
      `${b.decisionPath} commits to test seed ${String(d.test_seed)}, the test data are seed ${h.dataset_seed}`,
    );
  if (h.generator_git_dirty !== false)
    throw new UsageError(`${b.truthPath}: generated from a dirty tree (or provenance unknown)`);
  if (d.plan == null || d.plan !== b.planPath)
    throw new UsageError(`${b.decisionPath} names plan ${String(d.plan)}, not ${b.planPath}`);
  deps.checkDigests(b.planPath, dirname(b.truthPath));
  if (d.reference_estimator == null || d.reference_estimator !== b.reference)
    throw new UsageError(
      `${b.decisionPath} freezes reference ${String(d.reference_estimator)}, the reference predictions are ${b.reference}`,
    );
  if (d.carried_model == null || d.carried_model !== b.network)
    throw new UsageError(
      `${b.decisionPath} carries ${String(d.carried_model)}, the network predictions are ${b.network}`,
    );
  const manifest = JSON.parse(readFileSync(join(b.modelDir, "manifest.json"), "utf8")) as {
    id?: string;
    git_commit?: string;
  };
  if (manifest.id !== b.network)
    throw new UsageError(`${b.modelDir} is model ${String(manifest.id)}, not ${b.network}`);
  if (
    typeof manifest.git_commit !== "string" ||
    !deps.precedes(b.decisionPath, manifest.git_commit)
  )
    throw new UsageError(
      `the decision was not committed before ${b.network} was trained (commit ${String(manifest.git_commit)})`,
    );
  return d;
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

/** Medians and P90s of every set on the G4 rows and the control rows (FR-010). */
export function g4Report(truth: Scenario[], sets: PredictionSet[]): Summary[] {
  const out: Summary[] = [];
  const g4 = g4Rows(truth);
  const sigma1Held = truth.filter(
    (s) =>
      Math.abs(s.metadata.parameters.noise_sigma_rad - Math.PI / 180) < 1e-6 &&
      s.metadata.manoeuvre_index == null,
  );
  const finite = (v: number): number | null => (Number.isFinite(v) ? v : null);
  const summarise = (
    set: PredictionSet,
    rows: { s: Scenario; k: number }[],
    label: string,
    metric: "range_rel" | "course_deg" | "speed_kt",
  ): void => {
    const xs: number[] = [];
    let nc = 0;
    for (const { s, k } of rows) {
      const p = set.byIndex.get(s.metadata.index);
      const dt = s.metadata.parameters.dt_s;
      const r = p?.rows.find((x) => Math.round(x.timestamp_s / dt) === k);
      if (r === undefined || !r.converged) {
        nc++;
        xs.push(Infinity);
      } else xs.push(rowError(s, r)[metric]);
    }
    const a = Float64Array.from(xs);
    out.push({
      estimator: set.label,
      rows: label,
      metric,
      n: xs.length,
      median: xs.length ? finite(selectQuantile(Float64Array.from(a), 0.5)) : null,
      p90: xs.length ? finite(selectQuantile(Float64Array.from(a), 0.9)) : null,
      non_converged: nc,
    });
  };
  for (const set of sets) {
    for (const m of ["range_rel", "course_deg", "speed_kt"] as const)
      summarise(set, g4, "turning, manoeuvre+300s", m);
    for (const c of G2_CRITERIA) {
      const rows = sigma1Held
        .map((s) => ({
          s,
          k: s.metadata.zig_index + Math.round(c.seconds / s.metadata.parameters.dt_s),
        }))
        .filter(({ s, k }) => k < s.metadata.samples);
      summarise(set, rows, `held course, zig+${String(c.seconds)}s`, c.metric);
    }
  }
  return out;
}

export function main(argv: string[]): unknown {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      truth: { type: "string" },
      network: { type: "string" },
      reference: { type: "string" },
      also: { type: "string", multiple: true },
      experiment: { type: "string" },
      decision: { type: "string" },
      plan: { type: "string" },
      model: { type: "string" },
    },
  });
  const { truth, network, reference, experiment } = values;
  if (!truth || !network || !reference || !experiment) throw new UsageError(USAGE);
  const net = openPredictionSet(network, truth);
  const ref = openPredictionSet(reference, truth);
  const also = (values.also ?? []).map((p) => openPredictionSet(p, truth));
  const gate = readDataset(truth).header.split === "test";
  if (gate) {
    if (!values.decision || !values.plan || !values.model)
      throw new UsageError(`a test split needs --decision, --plan and --model\n${USAGE}`);
    requireG4Binding({
      decisionPath: values.decision,
      planPath: values.plan,
      modelDir: values.model,
      truthPath: truth,
      network: net.estimator,
      reference: ref.estimator,
    });
  }
  const out = join(experiment, gate ? "verdict.json" : "diagnostic.json");
  if (existsSync(out)) throw new UsageError(`${out} exists: a G4 split is scored once`);
  const scenarios = Array.from(scenarioSource(truth));
  const judged = g4Verdict(g4Checks(scenarios, net, ref));
  const verdict = gate
    ? judged
    : { ...judged, decided_by: "validation diagnostic (spec 010 FR-007): not a gate decision" };
  mkdirSync(experiment, { recursive: true });
  writeFileSync(out, prettyJson(verdict));
  writeFileSync(
    join(experiment, "report.json"),
    prettyJson(g4Report(scenarios, [net, ref, ...also])),
  );
  if (gate && verdict.result !== "pass") process.exitCode = 3;
  return {
    experiment,
    gate: verdict.gate,
    result: verdict.result,
    checks: verdict.checks.map((k) => `${k.name}: ${k.result}`),
  };
}

if (isMain(import.meta.url)) {
  // runCli's 0 must not overwrite exit 3 (gate not passed), set inside main.
  const code = runCli(main, process.argv.slice(2));
  if (code !== 0) process.exitCode = code;
}
