// tma-g3 (spec 009): G3 for the hybrid against classical on one test split (gate-g3.ts). Writes
// <experiment>/verdict.json for a test split (the gate), diagnostic.json for any other, once each.
// On a test split the committed decision record must name its seed, and the test data must come
// from a clean tree at the decision's commit or after it (spec 015 FR-005). A decision that names
// plans or freezes models (`model_digests`) binds them too: the plans' digests are checked, the
// --model directories must be the frozen models byte for byte, and the hybrid file must trace to
// their weights through its inputs (tma-hybrid records them from schema 0.18.0) and --network.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { isMain, readDataset, runCli, UsageError } from "@tma/data";
import { ChangeDecision, type DatasetHeader, parseRecord } from "@tma/types";
import { defaultDeps } from "./cli-g4.js";
import { type G5BindingDeps, requireFrozenModels, requirePredictionChain } from "./cli-g5.js";
import { prettyJson } from "./experiment.js";
import { g3Checks, g3Verdict } from "./gate-g3.js";
import { openPredictionSet, scenarioSource } from "./prediction-file.js";

const USAGE =
  "usage: tma-g3 --truth <test.f32pack> --hybrid <hybrid.ndjson> --classical <classical.ndjson> [--decision <decision.json> [--plan <plan.json>]... [--model <model dir>]... [--network <network.ndjson>]] --experiment <dir> (--decision required on a test split; --plan, --model and --network when the decision names plans or frozen models)";

/** Tracked by git and unmodified against HEAD. */
function committed(path: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", path], { stdio: "ignore" });
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", path], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** The committed decision that pre-registers this test split (its seed), or a usage error. */
export function requireG3Decision(
  decisionPath: string,
  truthPath: string,
  isCommitted: (path: string) => boolean = committed,
  header: DatasetHeader = readDataset(truthPath).header,
): ChangeDecision {
  if (!isCommitted(decisionPath))
    throw new UsageError(`${decisionPath}: the decision must be committed before G3 is scored`);
  const d = parseRecord(
    ChangeDecision,
    JSON.parse(readFileSync(decisionPath, "utf8")),
    decisionPath,
    1,
  );
  const h = header;
  if (d.test_seed == null || d.test_seed !== h.dataset_seed)
    throw new UsageError(
      `${decisionPath} commits to test seed ${String(d.test_seed)}, the test data are seed ${h.dataset_seed}`,
    );
  if (h.generator_git_dirty !== false)
    throw new UsageError(`${truthPath}: generated from a dirty tree (or provenance unknown)`);
  return d;
}

export interface G3Binding {
  decisionPath: string;
  truthPath: string;
  planPaths: string[];
  modelDirs: string[];
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const sb = [...b].sort();
  return a.length === b.length && [...a].sort().every((x, i) => x === sb[i]);
};

/**
 * Every binding of a G3 test split (spec 015 FR-005): `requireG3Decision`; data generated at or
 * after the commit that added the decision; the decision's plans (`plan` or `plans`), if any,
 * given and their digests checked; its frozen models (`model_digests`), if any, given byte for
 * byte. Returns the decision and whether it freezes models (the caller then checks the chain).
 */
export function requireG3Binding(
  b: G3Binding,
  deps: G5BindingDeps = defaultDeps,
): { decision: ChangeDecision; frozen: boolean } {
  const h = (deps.truthHeader ?? ((p: string) => readDataset(p).header))(b.truthPath);
  const d = requireG3Decision(b.decisionPath, b.truthPath, deps.isCommitted, h);
  if (h.generator_git_commit == null || !deps.precedes(b.decisionPath, h.generator_git_commit))
    throw new UsageError(
      `${b.truthPath}: generated at commit ${String(h.generator_git_commit)}, which does not descend from the commit that added ${b.decisionPath}`,
    );
  const plans = [...(d.plans ?? []), ...(d.plan == null ? [] : [d.plan])];
  if (!sameSet([...new Set(plans)], b.planPaths))
    throw new UsageError(
      `${b.decisionPath} names plans ${plans.join(", ") || "(none)"}, not ${b.planPaths.join(", ") || "(none)"}`,
    );
  for (const p of b.planPaths) deps.checkDigests(p, dirname(b.truthPath));
  const frozen = (d.model_digests ?? []).length > 0;
  if (frozen) requireFrozenModels(d, b.modelDirs, b.decisionPath);
  else if (b.modelDirs.length > 0)
    throw new UsageError(`${b.decisionPath} freezes no models: --model is not used`);
  return { decision: d, frozen };
}

export function main(argv: string[]): unknown {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      truth: { type: "string" },
      hybrid: { type: "string" },
      classical: { type: "string" },
      experiment: { type: "string" },
      decision: { type: "string" },
      plan: { type: "string", multiple: true },
      model: { type: "string", multiple: true },
      network: { type: "string" },
    },
  });
  const { truth, hybrid, classical, experiment, decision } = values;
  if (!truth || !hybrid || !classical || !experiment) throw new UsageError(USAGE);
  // A test split is the gate: it needs the decision. Any other split is a diagnostic (B.3.3).
  const gate = readDataset(truth).header.split === "test";
  if (gate && !decision) throw new UsageError(`a test split needs --decision\n${USAGE}`);
  const h = openPredictionSet(hybrid, truth);
  const c = openPredictionSet(classical, truth);
  if (gate && decision) {
    const modelDirs = values.model ?? [];
    const { frozen } = requireG3Binding({
      decisionPath: decision,
      truthPath: truth,
      planPaths: values.plan ?? [],
      modelDirs,
    });
    if (frozen) {
      if (!values.network)
        throw new UsageError(`the decision freezes models: a test split needs --network\n${USAGE}`);
      requirePredictionChain([h], [c, openPredictionSet(values.network, truth)], modelDirs);
    }
  }
  const out = join(experiment, gate ? "verdict.json" : "diagnostic.json");
  if (existsSync(out)) throw new UsageError(`${out} exists: a G3 split is scored once`);
  if (!h.estimator.startsWith("hybrid-")) throw new UsageError(`${hybrid}: not hybrid predictions`);
  if (c.estimator !== "classical") throw new UsageError(`${classical}: not classical predictions`);
  const judged = g3Verdict(g3Checks(scenarioSource(truth), h, c));
  const verdict = gate
    ? judged
    : { ...judged, decided_by: "validation diagnostic (Annex A B.3.3): not a gate decision" };
  mkdirSync(experiment, { recursive: true });
  writeFileSync(out, prettyJson(verdict));
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
