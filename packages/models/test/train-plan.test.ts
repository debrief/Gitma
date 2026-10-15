// T040: scripts/train-plan.mjs, the logic train.yml and the CI plan step run (spawned as in CI).
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fileSha256, generateDataset } from "@tma/data";
import { DEFAULT_RANGES, HELDOUT_RANGES } from "@tma/sim";
import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "train-plan.mjs");

function run(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): { status: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: opts.cwd ?? ROOT,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...opts.env },
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

const MODELS = ["instantaneous", "time-late", "causal-cnn", "mlp", "instantaneous-shuffled"];

describe("plan resolution", () => {
  it("train/i2a → configs/iter2/a/plan.json, with the phase A models and a validation evaluation", () => {
    const r = run(["resolve"], { env: { REF_NAME: "train/i2a" } });
    expect(r.status).toBe(0);
    expect(r.out).toContain("plan=configs/iter2/a/plan.json\n");
    expect(r.out).toContain("id=i2a\n");
    expect(r.out).toContain(`models=${JSON.stringify(MODELS)}\n`);
    expect(r.out).toContain("split=validation\n");
    expect(r.out).toContain("command=tma-g2\n");
  });

  it("train/i2s → the capacity scan: tma-scan on validation, plain arguments (R20)", () => {
    const r = run(["resolve"], { env: { REF_NAME: "train/i2s" } });
    expect(r.status).toBe(0);
    expect(r.out).toContain("plan=configs/iter2/s/plan.json\n");
    expect(r.out).toContain("command=tma-scan\n");
    expect(r.out).toContain("split=validation\n");
    const args = run(["evaluate-args", "configs/iter2/s/plan.json", "D", "M", "E"]);
    expect(args.out.trim().split("\n")).toEqual([
      "--data",
      "D",
      "--models",
      "M",
      "--experiment",
      "E",
    ]);
    const s = JSON.parse(readFileSync(join(ROOT, "configs/iter2/s/plan.json"), "utf8")) as {
      dataset: unknown;
      continue_from?: unknown;
    };
    const b = JSON.parse(readFileSync(join(ROOT, "configs/iter2/b/plan.json"), "utf8")) as {
      dataset: unknown;
    };
    expect(s.dataset).toEqual(b.dataset); // the iteration-2 data, from scratch
    expect(s.continue_from).toBeUndefined();
  });

  it("writes the outputs to $GITHUB_OUTPUT; a workflow input wins over the branch", () => {
    const out = join(tempDir(), "out");
    writeFileSync(out, "");
    const r = run(["resolve"], {
      env: { REF_NAME: "train/i2a", PLAN: "ci/derived", GITHUB_OUTPUT: out },
    });
    expect(r.status).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("plan=configs/ci/derived/plan.json\n");
  });

  it("refuses branches that name no plan (iteration 1's train/i1 path is retired) and missing plans", () => {
    expect(run(["resolve"], { env: { REF_NAME: "train/g1-rerun" } }).status).toBe(2);
    const i1 = run(["resolve"], { env: { REF_NAME: "train/i1a" } });
    expect(i1.status).toBe(2);
    expect(i1.err).toMatch(/configs\/iter1\/a\/plan.json: no such plan/);
    expect(run(["resolve"], { env: { PLAN: "../etc" } }).status).toBe(2);
  });

  it("every committed plan validates; phase A configs follow decisions 9 and 10", () => {
    for (const p of [
      "configs/iter2/a/plan.json",
      "configs/iter2/b/plan.json",
      "configs/iter2/c/plan.json",
      "configs/iter2/s/plan.json",
      "configs/ci/plan.json",
      "configs/ci/derived/plan.json",
    ]) {
      expect(run(["validate", p]).status, p).toBe(0);
    }
    for (const m of MODELS) {
      const a = JSON.parse(
        readFileSync(join(ROOT, "configs/iter2/a", `${m}.json`), "utf8"),
      ) as Record<string, unknown>;
      const g1 = JSON.parse(
        readFileSync(join(ROOT, "configs/iter1", `${m}.json`), "utf8"),
      ) as Record<string, unknown>;
      expect(a).toMatchObject({
        max_epochs: 60,
        patience: 3,
        max_wall_s: 172800,
        tfjs_threads: 1,
        feature_set: "raw",
        length_bucketing: m !== "mlp", // the MLP's dense layers need all 240 rows (PR #31)
      });
      for (const k of [
        "id",
        "model_kind",
        "units",
        "learning_rate",
        "batch_size",
        "train_seed",
        "shuffle_labels",
        "loss_weight_range",
        "loss_weight_course",
        "loss_weight_speed",
        "kernel_size",
        "layers",
      ]) {
        expect(a[k], `${m}.${k}`).toEqual(g1[k]);
      }
    }
  });
});

describe("plan validation", () => {
  /** A scratch checkout holding one iteration-2 plan, its configs and ranges. */
  function workspace(edit: (plan: Record<string, unknown>) => void = () => undefined): string {
    const dir = tempDir();
    cpSync(join(ROOT, "configs"), join(dir, "configs"), { recursive: true });
    const p = join(dir, "configs/iter2/a/plan.json");
    const plan = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    edit(plan);
    writeFileSync(p, JSON.stringify(plan));
    return dir;
  }
  const dataset = (p: Record<string, unknown>) => p.dataset as Record<string, unknown>;
  const validate = (dir: string) => run(["validate", "configs/iter2/a/plan.json"], { cwd: dir });

  it("an iteration-2 plan can never regenerate the G0 or iteration-1 dataset", () => {
    for (const seed of ["101", "42"]) {
      const r = validate(workspace((p) => (dataset(p).seed = seed)));
      expect(r.status).toBe(2);
      expect(r.err).toMatch(/reserved for (iteration 1|G0)/);
    }
    for (const k of ["ranges", "heldout_ranges"]) {
      const r = validate(workspace((p) => (dataset(p)[k] = "configs/iter1-ranges.json")));
      expect(r.status).toBe(2);
      expect(r.err).toMatch(/iteration-2 ranges file/);
    }
  });

  it("refuses a config whose feature set differs from the plan's, bad digests and bad evaluate", () => {
    expect(validate(workspace((p) => (p.feature_set = "derived"))).err).toMatch(
      /uses feature set raw/,
    );
    expect(
      validate(
        workspace((p) => ((dataset(p).digests as Record<string, string>)["test.f32pack"] = "abc")),
      ).status,
    ).toBe(2);
    expect(
      validate(workspace((p) => (p.evaluate = { command: "tma-g1", split: "validation" }))).status,
    ).toBe(2);
    expect(
      validate(
        workspace(
          (p) => (p.evaluate = { command: "tma-g2", split: "validation", decision: "d.json" }),
        ),
      ).err,
    ).toMatch(/validation evaluation takes no decision/);
    expect(validate(workspace((p) => (p.models = ["no-such-model"]))).err).toMatch(/no config/);
    // A scan never touches the test split.
    expect(
      validate(workspace((p) => (p.evaluate = { command: "tma-scan", split: "test" }))).err,
    ).toMatch(/validation only/);
    expect(
      validate(workspace((p) => (p.evaluate = { command: "tma-scan", split: "validation" })))
        .status,
    ).toBe(0);
  });

  it("a fresh test split needs its own unreserved seed and a digest (spec 004 decision 17)", () => {
    const fresh = (f: unknown) => workspace((p) => (dataset(p).fresh_test = f));
    expect(validate(fresh({ seed: "204", digest: "PLACEHOLDER" })).status).toBe(0);
    expect(validate(fresh({ seed: "201", digest: "PLACEHOLDER" })).err).toMatch(
      /must differ from dataset.seed/,
    );
    expect(validate(fresh({ seed: "101", digest: "PLACEHOLDER" })).err).toMatch(
      /reserved for iteration 1/,
    );
    // Seeds whose test split already decided a gate (201: iteration 2, 202: iteration 2b).
    expect(validate(fresh({ seed: "202", digest: "PLACEHOLDER" })).err).toMatch(
      /reserved for iteration 2b/,
    );
    expect(validate(fresh({ seed: "204", digest: "abc" })).err).toMatch(/fresh_test.digest/);
    expect(validate(fresh({ digest: "PLACEHOLDER" })).err).toMatch(/fresh_test.seed/);
  });
});

describe("dataset content digests", () => {
  const gen = (dir: string, commit: string) =>
    generateDataset({
      seed: 5n,
      count: 30,
      outDir: dir,
      ranges: DEFAULT_RANGES,
      heldoutRanges: HELDOUT_RANGES,
      format: "f32pack",
      createdBy: "test",
      provenance: { generator_git_commit: commit, generator_git_dirty: false },
    });

  it("ignore the header (generator commit) but see every scenario byte", () => {
    const a = tempDir();
    const b = tempDir();
    gen(a, "a".repeat(40));
    gen(b, "b".repeat(40));
    const fa = join(a, "train.f32pack");
    const fb = join(b, "train.f32pack");
    expect(fileSha256(fa)).not.toBe(fileSha256(fb));
    const da = run(["digest", fa]).out.split(" ")[0];
    expect(da).toMatch(/^[0-9a-f]{64}$/);
    expect(run(["digest", fb]).out.split(" ")[0]).toBe(da);
    const bytes = readFileSync(fa);
    bytes[bytes.length - 3] = (bytes[bytes.length - 3] ?? 0) ^ 1; // one bit of the last scenario
    writeFileSync(fa, bytes);
    expect(run(["digest", fa]).out.split(" ")[0]).not.toBe(da);
  });

  it("check-digests passes on matching data and fails, naming the file, on any difference", () => {
    const data = tempDir();
    gen(data, "c".repeat(40));
    const digests = Object.fromEntries(
      ["train", "validation", "test", "heldout"].map((s) => [
        `${s}.f32pack`,
        run(["digest", join(data, `${s}.f32pack`)]).out.split(" ")[0] ?? "",
      ]),
    );
    const dir = tempDir();
    cpSync(join(ROOT, "configs"), join(dir, "configs"), { recursive: true });
    const p = join(dir, "configs/iter2/a/plan.json");
    const plan = JSON.parse(readFileSync(p, "utf8")) as {
      dataset: { digests: Record<string, string> };
    };
    plan.dataset.digests = { ...digests };
    writeFileSync(p, JSON.stringify(plan));
    const check = () => run(["check-digests", "configs/iter2/a/plan.json", data], { cwd: dir });
    expect(check().status).toBe(0);
    plan.dataset.digests["validation.f32pack"] = "0".repeat(64);
    writeFileSync(p, JSON.stringify(plan));
    const bad = check();
    expect(bad.status).toBe(2);
    expect(bad.err).toMatch(/BAD validation.f32pack/);
    expect(bad.err).toMatch(/generator changed/);
    plan.dataset.digests["validation.f32pack"] = "PLACEHOLDER";
    writeFileSync(p, JSON.stringify(plan));
    expect(check().err).toMatch(/placeholders/);

    // With a fresh test split, test.f32pack is checked against the fresh digest, not the plan's.
    plan.dataset.digests["validation.f32pack"] = digests["validation.f32pack"] ?? "";
    const withFresh = plan as unknown as { dataset: Record<string, unknown> };
    withFresh.dataset.fresh_test = { seed: "204", digest: digests["test.f32pack"] };
    plan.dataset.digests["test.f32pack"] = "0".repeat(64);
    writeFileSync(p, JSON.stringify(plan));
    expect(check().status).toBe(0);
    withFresh.dataset.fresh_test = { seed: "204", digest: "1".repeat(64) };
    writeFileSync(p, JSON.stringify(plan));
    expect(check().err).toMatch(/BAD test.f32pack .*\(plan: 1{64}\)/);
  });
});

describe("model completion and evaluation arguments", () => {
  it("complete: only a manifest marked complete with final weights", () => {
    const d = tempDir();
    expect(run(["complete", d]).status).toBe(1);
    writeFileSync(join(d, "manifest.json"), JSON.stringify({ complete: false }));
    writeFileSync(join(d, "weights.bin"), "");
    expect(run(["complete", d]).status).toBe(1);
    writeFileSync(join(d, "manifest.json"), JSON.stringify({ complete: true }));
    expect(run(["complete", d]).status).toBe(0);
    mkdirSync(join(d, "x"));
    expect(run(["complete", join(d, "x")]).status).toBe(1);
  });

  it("evaluate-args: a validation plan passes --split validation and nothing else", () => {
    const r = run(["evaluate-args", "configs/iter2/a/plan.json", "D", "M", "E"]);
    expect(r.out.trim().split("\n")).toEqual([
      "--data",
      "D",
      "--models",
      "M",
      "--experiment",
      "E",
      "--split",
      "validation",
    ]);
  });
});
