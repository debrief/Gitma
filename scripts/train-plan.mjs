// Training plans for .github/workflows/train.yml (spec 003 T040, contracts/cli.md "Workflow").
// A plan is configs/<plan>/plan.json: the dataset command, its expected content digests, the
// feature set, the model configs and the evaluation step. The workflow calls this script for
// everything but the YAML wiring, so the logic is unit-tested (packages/models/test/train-plan.test.ts).
//
//   train-plan.mjs resolve                    plan for $PLAN (workflow input, e.g. iter2/a) or
//                                             $REF_NAME (train/i2a → configs/iter2/a/plan.json);
//                                             writes plan=, id=, models=, ... to $GITHUB_OUTPUT
//   train-plan.mjs validate <plan.json>       checks the plan and its configs
//   train-plan.mjs digest <f32pack>...        content digest of each dataset file
//   train-plan.mjs check-digests <plan> <dir> regenerated data must match the plan's digests
//   train-plan.mjs data <plan> <dir> [split]... generate, check digests, norm, build features
//   train-plan.mjs complete <model dir>       exit 0 if the dir holds a completed model, else 1
//   train-plan.mjs evaluate-args <plan> <data> <models> <experiment>   tma-g2 arguments, one per line
//
// Content digest: SHA-256 of a .f32pack from its first scenario block to the end, i.e. every
// scenario's metadata, ownship, target and observations, but not the header. The header records
// the generator commit (spec 003 R2), which changes with every commit, so a whole-file digest could
// never be pinned in a committed plan; provenance is checked separately by tma-train (lineage).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

export const SPLITS = ["train", "validation", "test", "heldout"];
const FEATURE_SETS = ["raw", "derived"];
const PLACEHOLDER = /^PLACEHOLDER/;
/** Dataset seeds of earlier gates (G0 review process rule: one seed per dataset). */
export const RESERVED_SEEDS = {
  42: "G0",
  101: "iteration 1",
  202: "iteration 2b G2 (fresh test)",
  203: "iteration 2c G2 (fresh test)",
};
/** Dataset seeds owned by one iteration's plans: its test split decided that iteration's gate. */
export const ITERATION_DATASET_SEEDS = { 201: "2", 204: "3" };
/**
 * Seeds whose test split has already decided a gate: a fresh test split may use one only in the
 * plan that decided it (so the committed plan of record still validates), never in another.
 */
export const RESERVED_TEST_SEEDS = {
  42: { for: "G0" },
  101: { for: "iteration 1" },
  201: { for: "iteration 2 G2 (the iteration-2 dataset's own test split)" },
  202: { for: "iteration 2b G2", plan: "configs/iter2/c/plan.json" },
  203: { for: "iteration 2c G2", plan: "configs/iter2/d/plan.json" },
  204: { for: "iteration 3 G2 (the iteration-3 dataset's own test split)" },
};

class PlanError extends Error {}

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  let off = 0;
  while (off < len) {
    const n = readSync(fd, buf, off, len - off, pos + off);
    if (n === 0) throw new PlanError("truncated .f32pack");
    off += n;
  }
  return buf;
}

/** SHA-256 of a .f32pack's scenario blocks (header excluded; see the file comment). */
export function contentDigest(path) {
  const fd = openSync(path, "r");
  try {
    const fixed = readAt(fd, 0, 16);
    if (fixed.toString("latin1", 0, 8) !== "TMAPACK\0")
      throw new PlanError(`${path}: not a .f32pack`);
    const h = fixed.readUInt32LE(12);
    const first = Number(readAt(fd, 16 + h + 4, 8).readBigUInt64LE(0));
    const hash = createHash("sha256");
    const buf = Buffer.alloc(1 << 20);
    let pos = first;
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n === 0) break;
      hash.update(buf.subarray(0, n));
      pos += n;
    }
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}

/** configs/<x>/plan.json for a workflow input (`iter2/a`) or a train branch (`train/i2a`). */
export function planPath(input, ref) {
  if (input) {
    if (!/^[a-z0-9][a-z0-9/_-]*$/.test(input) || input.includes(".."))
      throw new PlanError(`bad plan input "${input}"`);
    return `configs/${input.replace(/\/$/, "")}/plan.json`;
  }
  const m = /^train\/i(\d+)([a-z])(?:[-/].*)?$/.exec(ref ?? "");
  if (m === null) {
    throw new PlanError(
      `branch "${ref}" names no plan: push train/i<iteration><phase> (e.g. train/i2a → configs/iter2/a/plan.json) or dispatch with a plan input`,
    );
  }
  return `configs/iter${m[1]}/${m[2]}/plan.json`;
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Parses and checks a plan, including that each model config exists and uses its feature set. */
export function loadPlan(path) {
  if (!existsSync(path)) throw new PlanError(`${path}: no such plan`);
  const p = JSON.parse(readFileSync(path, "utf8"));
  const fail = (msg) => {
    throw new PlanError(`${path}: ${msg}`);
  };
  if (typeof p.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(p.id)) fail("id must be a slug");
  const d = p.dataset;
  if (!isObject(d)) fail("dataset missing");
  if (typeof d.seed !== "string" || !/^\d+$/.test(d.seed))
    fail("dataset.seed must be a decimal string");
  if (!Number.isInteger(d.count) || d.count < 1) fail("dataset.count must be a positive integer");
  for (const k of ["ranges", "heldout_ranges"]) {
    if (typeof d[k] !== "string" || !existsSync(d[k])) fail(`dataset.${k} must name a file`);
  }
  // An iteration-N plan (N ≥ 2) must use its own dataset: never an earlier gate's seed, and only
  // configs/iterN-* ranges (so train/i2* can never regenerate the iteration-1 data).
  const iter = /(?:^|\/)configs\/iter(\d+)\//.exec(path);
  // Reserved seeds are refused whatever the plan's path (G2 2b panel, red team round 2).
  if (Object.hasOwn(RESERVED_SEEDS, d.seed))
    fail(`dataset.seed ${d.seed} is reserved for ${RESERVED_SEEDS[d.seed]}`);
  const owner = ITERATION_DATASET_SEEDS[d.seed];
  if (owner !== undefined && iter?.[1] !== owner)
    fail(
      `dataset.seed ${d.seed} is the iteration-${owner} dataset: only configs/iter${owner}/ plans may use it`,
    );
  if (iter !== null && Number(iter[1]) >= 2) {
    const n = iter[1];
    for (const k of ["ranges", "heldout_ranges"]) {
      if (!d[k].startsWith(`configs/iter${n}-`))
        fail(`dataset.${k} must be an iteration-${n} ranges file (configs/iter${n}-*.json)`);
    }
  }
  if (!isObject(d.digests)) fail("dataset.digests missing");
  for (const s of SPLITS) {
    const v = d.digests[`${s}.f32pack`];
    if (typeof v !== "string" || !(/^[0-9a-f]{64}$/.test(v) || PLACEHOLDER.test(v)))
      fail(`dataset.digests["${s}.f32pack"] must be a SHA-256 (hex) or a PLACEHOLDER`);
  }
  // A fresh test split (spec 004 decision 17): the test split of another seed's dataset, same
  // ranges and count, so a test split that already decided a gate is never reused.
  if (d.fresh_test !== undefined) {
    const f = d.fresh_test;
    if (!isObject(f) || typeof f.seed !== "string" || !/^\d+$/.test(f.seed))
      fail("dataset.fresh_test.seed must be a decimal string");
    if (f.seed === d.seed) fail("dataset.fresh_test.seed must differ from dataset.seed");
    // The exemption is bound to the committed plan's path, not to its id (any plan can claim an id).
    const reserved = RESERVED_TEST_SEEDS[f.seed];
    if (reserved !== undefined && !path.replace(/\\/g, "/").endsWith(reserved.plan ?? "\0"))
      fail(`dataset.fresh_test.seed ${f.seed} is reserved for ${reserved.for}`);
    if (
      typeof f.digest !== "string" ||
      !(/^[0-9a-f]{64}$/.test(f.digest) || PLACEHOLDER.test(f.digest))
    )
      fail("dataset.fresh_test.digest must be a SHA-256 (hex) or a PLACEHOLDER");
  }
  if (!FEATURE_SETS.includes(p.feature_set)) fail("feature_set must be raw or derived");
  if (typeof p.configs !== "string") fail("configs must name a folder");
  if (!Array.isArray(p.models) || p.models.length === 0) fail("models must be a non-empty list");
  for (const m of p.models) {
    if (typeof m !== "string" || !/^[a-z0-9-]+$/.test(m))
      fail(`bad model name ${JSON.stringify(m)}`);
    const cp = join(p.configs, `${m}.json`);
    if (!existsSync(cp)) fail(`no config ${cp}`);
    const fs = JSON.parse(readFileSync(cp, "utf8")).feature_set ?? "raw";
    if (fs !== p.feature_set) fail(`${cp} uses feature set ${fs}; the plan's is ${p.feature_set}`);
  }
  if (p.continue_from !== undefined && !isObject(p.continue_from))
    fail("continue_from must be an object");
  if (
    p.continue_allow !== undefined &&
    (!Array.isArray(p.continue_allow) ||
      p.continue_allow.some((k) => typeof k !== "string" || !/^[a-z_]+$/.test(k)))
  )
    fail("continue_allow must be a list of config keys (the declared change)");
  if (p.continue_allow !== undefined && p.continue_from === undefined)
    fail("continue_allow needs continue_from");
  const e = p.evaluate;
  if (!isObject(e) || !["tma-g2", "tma-scan"].includes(e.command))
    fail('evaluate.command must be "tma-g2" or "tma-scan"');
  if (!["validation", "test"].includes(e.split)) fail("evaluate.split must be validation or test");
  for (const k of ["decision", "compare_models"]) {
    if (e[k] !== undefined && typeof e[k] !== "string") fail(`evaluate.${k} must be a path`);
  }
  if (e.split === "validation" && (e.decision !== undefined || e.compare_models !== undefined))
    fail("a validation evaluation takes no decision or compare_models");
  // A scan (side experiment, spec 003 R20) reports every model on validation; it never gates.
  if (e.command === "tma-scan" && e.split !== "validation")
    fail("a tma-scan evaluation is validation only");
  return p;
}

/** Workflow outputs for a plan. */
export function resolve(input, ref) {
  const path = planPath(input, ref);
  const p = loadPlan(path);
  return {
    plan: path,
    id: p.id,
    models: JSON.stringify(p.models),
    configs: p.configs,
    feature_set: p.feature_set,
    command: p.evaluate.command,
    split: p.evaluate.split,
    continue_from: JSON.stringify(p.continue_from ?? {}),
    continue_allow: (p.continue_allow ?? []).join(","),
  };
}

/** Compares regenerated data with the plan; returns printable lines, throws on any mismatch. */
export function checkDigests(plan, dir) {
  const lines = [];
  const bad = [];
  for (const s of SPLITS) {
    const f = `${s}.f32pack`;
    const fresh = s === "test" ? plan.dataset.fresh_test : undefined;
    const want = fresh === undefined ? plan.dataset.digests[f] : fresh.digest;
    const got = contentDigest(join(dir, f));
    const ok = got === want;
    lines.push(`${ok ? "ok " : "BAD"} ${f} content ${got}${ok ? "" : ` (plan: ${want})`}`);
    if (!ok) bad.push(f);
  }
  if (bad.length > 0) {
    const wanted = (f) =>
      f === "test.f32pack" && plan.dataset.fresh_test !== undefined
        ? plan.dataset.fresh_test.digest
        : plan.dataset.digests[f];
    const placeholder = bad.every((f) => PLACEHOLDER.test(wanted(f)));
    throw new PlanError(
      `${lines.join("\n")}\n${placeholder ? "the plan's digests are placeholders: record the ones printed above" : "regenerated data differ from the plan: the generator changed since the plan was pinned"}`,
    );
  }
  return lines;
}

const run = (script, args) =>
  execFileSync(process.execPath, [script, ...args], { stdio: ["ignore", "inherit", "inherit"] });

/**
 * Generate the plan's dataset, check its digests, and build features for `splits`. With a
 * `fresh_test`, test.f32pack is replaced by the test split of that seed's dataset (same count and
 * ranges); the plan's own test split is discarded, never scored.
 */
export function data(plan, dir, splits) {
  const d = plan.dataset;
  const generate = (seed, out) =>
    run("packages/data/dist/cli-generate.js", [
      "--seed",
      seed,
      "--count",
      String(d.count),
      "--ranges",
      d.ranges,
      "--heldout-ranges",
      d.heldout_ranges,
      "--out",
      out,
    ]);
  generate(d.seed, dir);
  if (d.fresh_test !== undefined) {
    const tmp = join(dir, ".fresh-test");
    rmSync(tmp, { recursive: true, force: true });
    generate(d.fresh_test.seed, tmp);
    renameSync(join(tmp, "test.f32pack"), join(dir, "test.f32pack"));
    rmSync(tmp, { recursive: true, force: true });
  }
  for (const l of checkDigests(plan, dir)) console.log(l);
  const fs = ["--feature-set", plan.feature_set];
  run("packages/features/dist/cli.js", [
    "norm",
    "--train",
    join(dir, "train.f32pack"),
    ...fs,
    "--out",
    join(dir, "norm.json"),
  ]);
  for (const s of splits) {
    run("packages/features/dist/cli.js", [
      "build",
      "--in",
      join(dir, `${s}.f32pack`),
      "--norm",
      join(dir, "norm.json"),
      ...fs,
      "--out",
      join(dir, `${s}.features.bin`),
    ]);
  }
}

/** True when `dir` holds a completed training run (manifest complete with final weights). */
export function complete(dir) {
  const m = join(dir, "manifest.json");
  if (!existsSync(m) || !existsSync(join(dir, "weights.bin"))) return false;
  return JSON.parse(readFileSync(m, "utf8")).complete === true;
}

/** Arguments for the plan's evaluation command (`planFile`: the plan's path, for --plan on test). */
export function evaluateArgs(plan, dataDir, models, experiment, planFile) {
  const e = plan.evaluate;
  if (e.command === "tma-scan")
    return ["--data", dataDir, "--models", models, "--experiment", experiment];
  return [
    "--data",
    dataDir,
    "--models",
    models,
    "--experiment",
    experiment,
    "--split",
    e.split,
    ...(e.decision === undefined ? [] : ["--decision", e.decision]),
    ...(e.compare_models === undefined ? [] : ["--compare-models", e.compare_models]),
    ...(e.split === "test" && planFile !== undefined ? ["--plan", planFile] : []),
  ];
}

function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "resolve": {
      const out = resolve(process.env.PLAN, process.env.REF_NAME);
      const text = Object.entries(out)
        .map(([k, v]) => `${k}=${v}\n`)
        .join("");
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, text);
      process.stdout.write(text);
      return 0;
    }
    case "validate":
      loadPlan(rest[0]);
      console.log(`${rest[0]}: ok`);
      return 0;
    case "digest":
      for (const f of rest) console.log(`${contentDigest(f)}  ${f}`);
      return 0;
    case "check-digests":
      for (const l of checkDigests(loadPlan(rest[0]), rest[1])) console.log(l);
      return 0;
    case "data": {
      const [planFile, dir, ...splits] = rest;
      data(loadPlan(planFile), dir, splits.length > 0 ? splits : ["train", "validation"]);
      return 0;
    }
    case "complete":
      return complete(rest[0]) ? 0 : 1;
    case "evaluate-args":
      for (const a of evaluateArgs(loadPlan(rest[0]), rest[1], rest[2], rest[3], rest[0]))
        console.log(a);
      return 0;
    default:
      console.error(
        "usage: train-plan.mjs resolve|validate|digest|check-digests|data|complete|evaluate-args …",
      );
      return 1;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = e instanceof PlanError ? 2 : 1;
  }
}
