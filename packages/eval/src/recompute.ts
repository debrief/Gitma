// Re-computing a sample of a gate's prediction files (spec 015 FR-001). A gate otherwise takes a
// tracker's settings from the estimator name in its file's header: a hand-made file with the right
// name and input digests would pass. Here every estimator whose name declares classical settings
// (IMM, EKF, the fused tracker, the tracker hybrid) is re-run from those settings on a seeded
// sample of scenarios, and its stored lines must match the re-computed ones byte for byte.
// A network's file (it names its weights) cannot be re-run without its model runtime; its rows
// enter as stored, bound by the weights digest the prediction chain checks.
import { createHash } from "node:crypto";
import {
  ekfPredict,
  fileDigest,
  fusedPredict,
  immPredict,
  parseEkfName,
  parseFusedName,
  parseImmName,
  parseTrackerHybridName,
  trackerHybrid,
} from "@tma/classical";
import { canonicalJson, UsageError } from "@tma/data";
import { createRng, uniformInt } from "@tma/sim";
import type { GateRecomputation, Prediction, Scenario } from "@tma/types";
import type { PredictionSet } from "./evaluate.js";
import { rawPredictionLine } from "./prediction-file.js";

/** Scenarios re-computed per estimator (spec 015 FR-001). */
export const RECOMPUTE_SCENARIOS = 200;
/** The sample's seed: the gate's own bootstrap seed (SRD Annex C §C.5). */
export const RECOMPUTE_SEED = 20261011n;

/**
 * `n` distinct scenario indices drawn from `indices` (partial Fisher–Yates, seeded), ascending;
 * all of them if there are no more than `n`.
 */
export function sampleScenarios(
  indices: readonly number[],
  n: number = RECOMPUTE_SCENARIOS,
  seed: bigint = RECOMPUTE_SEED,
): number[] {
  const pool = [...new Set(indices)].sort((a, b) => a - b);
  if (pool.length <= n) return pool;
  const rng = createRng(seed);
  for (let i = 0; i < n; i++) {
    const j = i + uniformInt(rng, pool.length - i);
    const a = pool[i];
    const b = pool[j];
    if (a === undefined || b === undefined) throw new Error("sample index out of range");
    pool[i] = b;
    pool[j] = a;
  }
  return pool.slice(0, n).sort((a, b) => a - b);
}

/** SHA-256 (hex) of a set's file, computed once per set. */
export type DigestOf = (s: PredictionSet) => string;

export function digestCache(): DigestOf {
  const cache = new Map<PredictionSet, string>();
  return (s) => {
    let d = cache.get(s);
    if (d === undefined) {
      if (s.path === undefined) throw new UsageError(`${s.label}: not opened from a file`);
      d = fileDigest(s.path);
      cache.set(s, d);
    }
    return d;
  };
}

/** How one estimator's rows are obtained for a scenario. */
type Recipe =
  { kind: "recompute"; run: (s: Scenario) => Prediction } | { kind: "stored"; set: PredictionSet };

/**
 * The recipe for `set`: its declared settings re-run, with inputs resolved among `given` by
 * estimator and file digest (each input is itself re-computed when it can be), or its stored rows
 * when it is a network's file. Refuses a file whose name declares no settings the gate can re-run
 * and that names no weights, or an input not among the files given.
 */
export function recipeFor(
  set: PredictionSet,
  given: readonly PredictionSet[],
  digestOf: DigestOf,
): Recipe {
  const where = set.path ?? set.label;
  const name = set.estimator;
  const inputs = set.header?.inputs ?? [];
  const input = (i: number): Recipe => {
    const want = inputs[i];
    if (want === undefined) throw new UsageError(`${where}: input ${String(i + 1)} missing`);
    const match = given.find((g) => g.estimator === want.estimator && digestOf(g) === want.sha256);
    if (match === undefined)
      throw new UsageError(
        `${where}: input ${want.estimator} (SHA-256 ${want.sha256}) is not among the files given`,
      );
    return recipeFor(match, given, digestOf);
  };
  const rowsOf = (r: Recipe, s: Scenario): Prediction => {
    if (r.kind === "recompute") return r.run(s);
    const p = r.set.byIndex.get(s.metadata.index);
    if (p === undefined)
      throw new UsageError(
        `${r.set.path ?? r.set.label}: no prediction for scenario ${String(s.metadata.index)}`,
      );
    return p;
  };
  const imm = parseImmName(name);
  if (imm !== null && inputs.length === 0)
    return { kind: "recompute", run: (s) => immPredict(s, imm) };
  const ekf = parseEkfName(name);
  if (ekf !== null && inputs.length === 0)
    return { kind: "recompute", run: (s) => ekfPredict(s, ekf.sigmaA, ekf.scales) };
  if (name.startsWith("fused-") && inputs.length === 1 && inputs[0] !== undefined) {
    const f = parseFusedName(name, inputs[0].estimator);
    if (f === null) throw new UsageError(`${where}: ${name} is not a canonical fused-tracker name`);
    const net = input(0);
    return { kind: "recompute", run: (s) => fusedPredict(s, f.imm, rowsOf(net, s), f.fusion) };
  }
  if (name.startsWith("hybrid-") && inputs.length === 2) {
    const [t, n] = inputs;
    const deg = t && n ? parseTrackerHybridName(name, n.estimator, t.estimator) : null;
    if (deg === null)
      throw new UsageError(`${where}: ${name} is not a canonical tracker-hybrid name`);
    const tr = input(0);
    const net = input(1);
    return {
      kind: "recompute",
      run: (s) => trackerHybrid(rowsOf(tr, s), rowsOf(net, s), deg),
    };
  }
  if (set.header?.model_weights_sha256 != null && inputs.length === 0)
    return { kind: "stored", set };
  throw new UsageError(
    `${where}: ${name} declares no settings the gate can re-compute and names no model weights`,
  );
}

/**
 * Re-computes `set` on the sampled scenarios of `truth` and requires each stored line to equal the
 * re-computed one, byte for byte. Returns the record for scoring.json, or null for a network's
 * file (stored rows, bound by weights). Throws naming the first scenario that differs.
 */
export function requireRecomputed(
  set: PredictionSet,
  given: readonly PredictionSet[],
  truth: readonly Scenario[],
  sample: readonly number[],
  digestOf: DigestOf,
): GateRecomputation | null {
  const recipe = recipeFor(set, given, digestOf);
  if (recipe.kind === "stored") return null;
  const where = set.path ?? set.label;
  const byIndex = new Map(truth.map((s) => [s.metadata.index, s]));
  for (const idx of sample) {
    const s = byIndex.get(idx);
    if (s === undefined) throw new UsageError(`scenario ${String(idx)} is not in the truth file`);
    const stored = rawPredictionLine(set, idx);
    if (stored === undefined)
      throw new UsageError(`${where}: no prediction for scenario ${String(idx)}`);
    if (canonicalJson(recipe.run(s)) !== stored)
      throw new UsageError(
        `${where}: scenario ${String(idx)} differs from ${set.estimator} re-computed from its declared settings`,
      );
  }
  return {
    estimator: set.estimator,
    scenarios: sample.length,
    sample_sha256: createHash("sha256").update(sample.join(",")).digest("hex"),
  };
}
