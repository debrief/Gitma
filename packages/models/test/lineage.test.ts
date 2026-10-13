// Training lineage refusals (spec 003 US1, T008; contracts/cli.md tma-train).
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readGitProvenance } from "@tma/data";
import type { FeatureSource } from "@tma/features";
import { DEFAULT_RANGES } from "@tma/sim";
import type { DatasetHeader, FeatureSet } from "@tma/types";
import { describe, expect, it } from "vitest";
import { main as cliTrain } from "../src/cli-train.js";
import { generatorPathsEqual } from "../src/g0-guard.js";
import {
  checkLineage,
  LineageError,
  type LineageFile,
  type LineageReason,
} from "../src/lineage.js";
import {
  FIXTURE_GIT,
  g0Experiments,
  tempDir,
  testSource,
  tinyConfig,
  tinyFeatures,
  VERIFIED_COMMIT,
} from "./helpers.js";

const file = (
  path: string,
  source: FeatureSource | undefined,
  featureSet: FeatureSet = "raw",
): LineageFile => ({ path, source, featureSet });

const good = (over: Partial<DatasetHeader> = {}, valOver: Partial<DatasetHeader> = {}) => ({
  train: file("train.features.bin", testSource("train", 201n, 80, over)),
  val: file("validation.features.bin", testSource("validation", 201n, 10, valOver)),
});

const run = (
  files: { train: LineageFile; val: LineageFile },
  featureSet?: FeatureSet,
  equal = FIXTURE_GIT.generatorPathsEqual,
) =>
  checkLineage({
    ...files,
    config: tinyConfig(
      "instantaneous",
      featureSet === undefined ? {} : { feature_set: featureSet },
    ),
    g0Commit: VERIFIED_COMMIT,
    generatorPathsEqual: equal,
  });

function refusal(f: () => unknown): LineageReason | null {
  try {
    f();
    return null;
  } catch (e) {
    if (e instanceof LineageError) return e.reason;
    throw e;
  }
}

describe("training lineage", () => {
  it("accepts one clean dataset generated at the G0-verified generator and returns its train header", () => {
    const files = good();
    expect(run(files)).toEqual(files.train.source?.header);
    expect(run(files, "raw")).toEqual(files.train.source?.header);
  });

  it("lineage-missing: format-1 features, or a header without provenance", () => {
    const g = good();
    expect(refusal(() => run({ ...g, train: file("t", undefined) }))).toBe("lineage-missing");
    expect(refusal(() => run({ ...g, val: file("v", undefined) }))).toBe("lineage-missing");
    const noCommit = good({ generator_git_commit: undefined });
    expect(refusal(() => run(noCommit))).toBe("lineage-missing");
    const nullDirty = good({}, { generator_git_dirty: null });
    expect(refusal(() => run(nullDirty))).toBe("lineage-missing");
  });

  it("lineage-dirty: a dataset generated with --allow-dirty", () => {
    expect(refusal(() => run(good({ generator_git_dirty: true })))).toBe("lineage-dirty");
    expect(refusal(() => run(good({}, { generator_git_dirty: true })))).toBe("lineage-dirty");
  });

  it("lineage-mismatch: generator paths differ from the G0 commit (injected diff)", () => {
    const other = "1".repeat(40);
    const both = good({ generator_git_commit: other }, { generator_git_commit: other });
    expect(refusal(() => run(both))).toBe("lineage-mismatch");
    // Another commit whose generator paths equal G0's is accepted: only the generator code counts.
    const sameCode = (a: string, b: string) => a === VERIFIED_COMMIT && (b === other || b === a);
    expect(refusal(() => run(both, undefined, sameCode))).toBeNull();
    // The diff function is asked about the G0 commit and the data's commit.
    const asked: string[][] = [];
    run(both, undefined, (a, b) => (asked.push([a, b]), true));
    expect(asked[0]).toEqual([VERIFIED_COMMIT, other]);
  });

  it("lineage-split-mismatch: train and validation from different datasets or wrong splits", () => {
    expect(refusal(() => run(good({}, { dataset_seed: "202" })))).toBe("lineage-split-mismatch");
    const otherCommit = "2".repeat(40);
    const sameCode = (a: string, b: string) =>
      a === VERIFIED_COMMIT && [a, otherCommit].includes(b);
    expect(
      refusal(() => run(good({}, { generator_git_commit: otherCommit }), undefined, sameCode)),
    ).toBe("lineage-split-mismatch");
    const g = good();
    const testAsVal = file("test.features.bin", testSource("test", 201n, 10));
    expect(refusal(() => run({ ...g, val: testAsVal }))).toBe("lineage-split-mismatch");
    expect(refusal(() => run({ train: g.val, val: g.train }))).toBe("lineage-split-mismatch");
    const heldoutRanges = { ...DEFAULT_RANGES, min_range_m: 200 };
    expect(refusal(() => run(good({}, { parameter_ranges: heldoutRanges })))).toBe(
      "lineage-split-mismatch",
    );
  });

  it("feature-set-mismatch: config feature set differs from the files'", () => {
    expect(refusal(() => run(good(), "derived"))).toBe("feature-set-mismatch");
    const g = good();
    const derived = { ...g, train: { ...g.train, featureSet: "derived" as const } };
    expect(refusal(() => run(derived))).toBe("feature-set-mismatch");
    expect(
      refusal(() => run({ ...derived, val: { ...g.val, featureSet: "derived" } }, "derived")),
    ).toBeNull();
  });

  it("generatorPathsEqual runs git: a commit equals itself; an unknown commit never matches", () => {
    const head = readGitProvenance().commit;
    expect(generatorPathsEqual(head, head)).toBe(true);
    expect(generatorPathsEqual(head, "0".repeat(40))).toBe(false);
  });
});

describe("tma-train refuses on lineage (exit 2 reasons)", () => {
  const data = tinyFeatures(8);
  const config = (): string => {
    const p = join(tempDir(), "config.json");
    writeFileSync(p, JSON.stringify(tinyConfig("instantaneous", { max_epochs: 1 })));
    return p;
  };
  const args = (train: string, val: string): string[] => [
    "--config",
    config(),
    "--train",
    train,
    "--val",
    val,
    "--out",
    join(tempDir(), "m"),
    "--experiments",
    g0Experiments(),
  ];

  it("refuses format-1 features before training starts", async () => {
    const v1 = new URL("../../features/test/fixtures/v1-seed1-2.features.bin", import.meta.url)
      .pathname;
    const train = join(tempDir(), "train.features.bin");
    copyFileSync(v1, train);
    await expect(cliTrain(args(train, data.val), FIXTURE_GIT)).rejects.toThrow(/^lineage-missing/);
  });

  it("refuses when the data's generator differs from the G0 commit", async () => {
    const differ = { ...FIXTURE_GIT, generatorPathsEqual: () => false };
    await expect(cliTrain(args(data.train, data.val), differ)).rejects.toThrow(/^lineage-mismatch/);
  });

  it("--check runs the guard and lineage only: passes clean data without training, refuses as training would", async () => {
    const a = args(data.train, data.val);
    const out = a[a.indexOf("--out") + 1] ?? "";
    await expect(cliTrain([...a, "--check"], FIXTURE_GIT)).resolves.toMatchObject({
      check: "pass",
      g0_experiment: "g0",
    });
    expect(existsSync(join(out, "manifest.json"))).toBe(false);
    const differ = { ...FIXTURE_GIT, generatorPathsEqual: () => false };
    await expect(cliTrain([...args(data.train, data.val), "--check"], differ)).rejects.toThrow(
      /^lineage-mismatch/,
    );
    const noG0 = [...args(data.train, data.val), "--check"];
    noG0[noG0.indexOf("--experiments") + 1] = tempDir();
    await expect(cliTrain(noG0, FIXTURE_GIT)).rejects.toThrow(/no passing G0 verdict/);
  });

  it("refuses validation features from another dataset", async () => {
    const other = tinyFeatures(8, 4n);
    await expect(cliTrain(args(data.train, other.val), FIXTURE_GIT)).rejects.toThrow(
      /^lineage-split-mismatch/,
    );
  });
});
