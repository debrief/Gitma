// tma-g3 (spec 009): G3 for the hybrid against classical on one test split (gate-g3.ts). Writes
// <experiment>/verdict.json for a test split (the gate), diagnostic.json for any other, once each.
// On a test split the committed decision record must name its seed, and the test data must come
// from a clean tree.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isMain, readDataset, runCli, UsageError } from "@tma/data";
import { ChangeDecision, parseRecord } from "@tma/types";
import { prettyJson } from "./experiment.js";
import { g3Checks, g3Verdict } from "./gate-g3.js";
import { openPredictionSet, scenarioSource } from "./prediction-file.js";

const USAGE =
  "usage: tma-g3 --truth <test.f32pack> --hybrid <hybrid.ndjson> --classical <classical.ndjson> [--decision <decision.json>] --experiment <dir> (--decision required on a test split)";

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
): ChangeDecision {
  if (!isCommitted(decisionPath))
    throw new UsageError(`${decisionPath}: the decision must be committed before G3 is scored`);
  const d = parseRecord(
    ChangeDecision,
    JSON.parse(readFileSync(decisionPath, "utf8")),
    decisionPath,
    1,
  );
  const h = readDataset(truthPath).header;
  if (d.test_seed == null || d.test_seed !== h.dataset_seed)
    throw new UsageError(
      `${decisionPath} commits to test seed ${String(d.test_seed)}, the test data are seed ${h.dataset_seed}`,
    );
  if (h.generator_git_dirty !== false)
    throw new UsageError(`${truthPath}: generated from a dirty tree (or provenance unknown)`);
  return d;
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
    },
  });
  const { truth, hybrid, classical, experiment, decision } = values;
  if (!truth || !hybrid || !classical || !experiment) throw new UsageError(USAGE);
  // A test split is the gate: it needs the decision. Any other split is a diagnostic (B.3.3).
  const gate = readDataset(truth).header.split === "test";
  if (gate) {
    if (!decision) throw new UsageError(`a test split needs --decision\n${USAGE}`);
    requireG3Decision(decision, truth);
  }
  const out = join(experiment, gate ? "verdict.json" : "diagnostic.json");
  if (existsSync(out)) throw new UsageError(`${out} exists: a G3 split is scored once`);
  const h = openPredictionSet(hybrid, truth);
  const c = openPredictionSet(classical, truth);
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
