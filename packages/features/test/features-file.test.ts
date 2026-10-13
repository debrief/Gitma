// Features format v2 (spec 003 US1, T007): source header and digest embedded; v1 still read.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateDataset, readDataset, runCli } from "@tma/data";
import { DEFAULT_RANGES, generateScenario, HELDOUT_RANGES } from "@tma/sim";
import { describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { FEATURE_FORMAT_VERSION, writeFeatures } from "../src/features-file.js";
import { computeNormalisation } from "../src/normalise.js";
import { openFeatures } from "../src/reader.js";
import { testSource } from "./helpers.js";

const tmp = (): string => mkdtempSync(join(tmpdir(), "tma-featfile-"));

describe("features file format v2", () => {
  const ss = [0, 1].map((i) => generateScenario(1n, i, DEFAULT_RANGES).scenario);
  const norm = computeNormalisation(ss, "golden");

  it("round-trips the source header, digest and feature set", () => {
    const src = testSource({ dataset_seed: "201", split: "validation" }, "ab".repeat(32));
    const path = join(tmp(), "f.bin");
    writeFeatures(path, () => ss, norm, src);
    const f = openFeatures(path);
    expect(FEATURE_FORMAT_VERSION).toBe(2);
    expect(f.version).toBe(2);
    expect(f.source).toEqual(src);
    expect(f.featureSet).toBe("raw");
    expect(f.layout.feature_set).toBe("raw");
    expect(f.norm).toEqual(norm);
    f.close();
  });

  it("still reads version-1 files (iteration 1): no source, raw, same windows", () => {
    // Committed before format 2: the iteration-1 features golden (seed 1, scenarios 0–1).
    const v1 = openFeatures(
      new URL("./fixtures/v1-seed1-2.features.bin", import.meta.url).pathname,
    );
    expect(v1.version).toBe(1);
    expect(v1.source).toBeUndefined();
    expect(v1.layout.feature_set).toBeUndefined();
    expect(v1.featureSet).toBe("raw");
    const path = join(tmp(), "f.bin");
    writeFeatures(path, () => ss, norm, testSource());
    const v2 = openFeatures(path);
    expect(v1.norm).toEqual(v2.norm);
    expect([...v1.indices]).toEqual([...v2.indices]);
    for (const k of [0, 1]) expect(v1.read(k)).toEqual(v2.read(k));
    v1.close();
    v2.close();
  });

  it("tma-features build embeds the split's header and the SHA-256 of its file", () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const dir = tmp();
    generateDataset({
      seed: 3n,
      count: 20,
      outDir: dir,
      ranges: DEFAULT_RANGES,
      heldoutRanges: HELDOUT_RANGES,
      format: "f32pack",
      createdBy: "test",
      provenance: { generator_git_commit: "c".repeat(40), generator_git_dirty: false },
    });
    const train = join(dir, "train.f32pack");
    const val = join(dir, "validation.f32pack");
    expect(runCli(main, ["norm", "--train", train, "--out", join(dir, "norm.json")])).toBe(0);
    const out = join(dir, "validation.features.bin");
    expect(
      runCli(main, ["build", "--in", val, "--norm", join(dir, "norm.json"), "--out", out]),
    ).toBe(0);
    const f = openFeatures(out);
    expect(f.source?.header).toEqual(readDataset(val).header);
    expect(f.source?.header.generator_git_commit).toBe("c".repeat(40));
    expect(f.source?.digest).toBe(createHash("sha256").update(readFileSync(val)).digest("hex"));
    f.close();
  });

  it("--feature-set derived: 13 named channels, the rate scale in norm; build refuses a raw norm", () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const dir = tmp();
    generateDataset({
      seed: 4n,
      count: 20,
      outDir: dir,
      ranges: DEFAULT_RANGES,
      heldoutRanges: HELDOUT_RANGES,
      format: "f32pack",
      createdBy: "test",
      provenance: { generator_git_commit: "c".repeat(40), generator_git_dirty: false },
    });
    const train = join(dir, "train.f32pack");
    const rawNorm = join(dir, "raw.json");
    const derNorm = join(dir, "derived.json");
    expect(runCli(main, ["norm", "--train", train, "--out", rawNorm])).toBe(0);
    expect(
      runCli(main, ["norm", "--train", train, "--feature-set", "derived", "--out", derNorm]),
    ).toBe(0);
    const rawConstants = JSON.parse(readFileSync(rawNorm, "utf8")) as Record<string, unknown>;
    const derConstants = JSON.parse(readFileSync(derNorm, "utf8")) as Record<string, unknown>;
    expect(rawConstants.bearing_rate_scale_rad_s).toBeUndefined();
    expect(derConstants.bearing_rate_scale_rad_s).toBeGreaterThan(0);
    const out = join(dir, "train.derived.features.bin");
    const build = (norm: string) =>
      runCli(main, [
        "build",
        "--in",
        train,
        "--norm",
        norm,
        "--feature-set",
        "derived",
        "--out",
        out,
      ]);
    expect(build(rawNorm)).toBe(2);
    expect(build(derNorm)).toBe(0);
    expect(
      runCli(main, ["norm", "--train", train, "--feature-set", "both", "--out", derNorm]),
    ).toBe(1);
    const f = openFeatures(out);
    expect(f.featureSet).toBe("derived");
    expect(f.inputChannels).toBe(13);
    expect(f.layout.input_channels.slice(10)).toEqual([
      "bearing_rate_scaled",
      "rate_valid",
      "intercept_scaled",
    ]);
    expect(f.read(0).inputs).toHaveLength(240 * 13);
    f.close();
  });
});
