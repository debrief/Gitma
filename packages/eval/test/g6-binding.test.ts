// Spec 017: tma-detect end to end, and tma-g6's test-split bindings. Each binding has a passing
// and a refusing case: the decision (seed, plans, detectors, thresholds, frozen models), data
// after the decision, the input chain, and the re-computed sample.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileDigest, type ImmParams, immName, immPredict } from "@tma/classical";
import { readDataset, runCli } from "@tma/data";
import type { Prediction, PredictionRow, Scenario } from "@tma/types";
import { describe, expect, it, vi } from "vitest";
import { main as generate } from "../../data/src/cli-generate.js";
import { main as detect } from "../src/cli-detect.js";
import { main as g6, requireDetectionChain, requireG6Binding } from "../src/cli-g6.js";
import { readDetectionSet } from "../src/detection-file.js";
import { openPredictionSet, openPredictionWriter, scenarioSource } from "../src/prediction-file.js";
import { truthRow } from "./helpers.js";

vi.spyOn(process.stdout, "write").mockImplementation(() => true);
vi.spyOn(process.stderr, "write").mockImplementation(() => true);

const configs = new URL("../../../configs/", import.meta.url).pathname;
const REF: ImmParams = {
  sigmaCv: 0.01,
  sigmaCt: 0.03,
  sigmaOmega: 0.01,
  switchPerS: 0.001,
  p0Scale: 4,
  rScale: 8,
  guardedInit: 1,
};
const IMM_ARGS = [
  "--sigma-cv",
  "0.01",
  "--sigma-ct",
  "0.03",
  "--sigma-omega",
  "0.01",
  "--switch",
  "0.001",
  "--p0-scale",
  "4",
  "--r-scale",
  "8",
  "--guarded-init",
  "1",
];

describe("tma-detect and tma-g6 bindings (spec 017)", () => {
  const dir = mkdtempSync(join(tmpdir(), "tma-g6-"));
  expect(
    runCli(generate, [
      "--seed",
      "31",
      "--count",
      "200",
      "--ranges",
      join(configs, "phase4-ranges.json"),
      "--heldout-ranges",
      join(configs, "phase4-heldout-ranges.json"),
      "--out",
      dir,
      "--allow-dirty",
    ]),
  ).toBe(0);
  const truth = join(dir, "test.f32pack");
  const scenarios: Scenario[] = Array.from(scenarioSource(truth));
  const weights = join(dir, "frozen");
  mkdirSync(weights, { recursive: true });
  writeFileSync(join(weights, "manifest.json"), JSON.stringify({ id: "lstm-gaussian" }));
  writeFileSync(join(weights, "model.json"), "{}");
  writeFileSync(join(weights, "weights.bin"), "w");
  const write = (
    name: string,
    est: string,
    make: (s: Scenario) => Prediction,
    prov = {},
  ): string => {
    const out = join(dir, name);
    const w = openPredictionWriter(out, est, "per_timestep", truth, prov);
    for (const s of scenarios) w.write(make(s));
    w.commit();
    return out;
  };
  /** A stand-in network: truth with its course turned by 0.1 rad. */
  const network = (s: Scenario): Prediction => {
    const rows: PredictionRow[] = [];
    for (let i = s.metadata.zig_index + 1; i < s.metadata.samples; i++) {
      const r = truthRow(s, i);
      rows.push({ ...r, course_rad: r.course_rad + 0.1, log_range_sd: 0.1 });
    }
    return {
      record: "prediction",
      scenario_index: s.metadata.index,
      estimator: "lstm-gaussian",
      mode: "per_timestep",
      rows,
    };
  };
  const t2 = write("t2.ndjson", "lstm-gaussian", network, {
    model_weights_sha256: fileDigest(join(weights, "weights.bin")),
  });
  const imm = write("imm.ndjson", immName(REF), (s) => immPredict(s, REF));
  const cusumOut = join(dir, "cusum.ndjson");
  const learnedOut = join(dir, "disagree.ndjson");

  it("tma-detect writes CUSUM and course-disagreement files, named by their settings", () => {
    expect(
      runCli(detect, [
        "--truth",
        truth,
        "--out",
        cusumOut,
        "--detector",
        "cusum",
        ...IMM_ARGS,
        "--kind",
        "mean",
        "--c",
        "0.5",
        "--clip",
        "3",
      ]),
    ).toBe(0);
    expect(
      runCli(detect, [
        "--truth",
        truth,
        "--out",
        learnedOut,
        "--detector",
        "disagree",
        "--network",
        t2,
        "--tracker",
        imm,
      ]),
    ).toBe(0);
    const c = readDetectionSet(cusumOut, truth);
    expect(c.detector).toBe(`cusum-mean-${immName(REF)}-c0.5-x3`);
    expect(c.byIndex.size).toBe(scenarios.length);
    const l = readDetectionSet(learnedOut, truth);
    expect(l.detector).toBe(`disagree-lstm-gaussian-${immName(REF)}`);
    expect(l.header.inputs?.map((i) => i.estimator)).toEqual(["lstm-gaussian", immName(REF)]);
    expect(() =>
      detect([
        "--truth",
        truth,
        "--out",
        join(dir, "x"),
        "--detector",
        "cusum",
        ...IMM_ARGS,
        "--kind",
        "var",
        "--c",
        "1",
        "--clip",
        "3",
      ]),
    ).toThrow(/nis or mean/);
  });

  it("re-computes a sample of both detectors, and refuses tampered or unbound files", () => {
    const c = readDetectionSet(cusumOut, truth);
    const l = readDetectionSet(learnedOut, truth);
    const also = [openPredictionSet(t2, truth), openPredictionSet(imm, truth)];
    expect(requireDetectionChain(l, c, also, [weights], scenarios).length).toBeGreaterThan(0);
    // One changed score in the CUSUM file.
    // One changed score in the CUSUM file, in a σ = 1° scenario (the only ones G6 scores).
    const one = scenarios.find(
      (s) => Math.abs(s.metadata.parameters.noise_sigma_rad - Math.PI / 180) < 1e-6,
    );
    if (one === undefined) throw new Error("no σ = 1° scenario");
    const lines = readFileSync(cusumOut, "utf8")
      .split("\n")
      .map((line) =>
        line.endsWith(`"scenario_index":${String(one.metadata.index)}}`)
          ? line.replace(/"score":0,/, '"score":7.5,')
          : line,
      );
    const bad = join(dir, "cusum-bad.ndjson");
    writeFileSync(bad, lines.join("\n"));
    expect(() =>
      requireDetectionChain(l, readDetectionSet(bad, truth), also, [weights], scenarios),
    ).toThrow(/differs from cusum-.* re-computed from its name/);
    // An input file not given, and a network not made with the bound weights.
    expect(() => requireDetectionChain(l, c, [also[1] as never], [weights], scenarios)).toThrow(
      /not among the --also files/,
    );
    writeFileSync(join(dir, "other.bin"), "x");
    const other = join(dir, "other");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "weights.bin"), "x");
    expect(() => requireDetectionChain(l, c, also, [other], scenarios)).toThrow(
      /--model's weights/,
    );
  });

  describe("the decision", () => {
    const decision = join(dir, "decision.json");
    const c = () => readDetectionSet(cusumOut, truth);
    const l = () => readDetectionSet(learnedOut, truth);
    const header = readDataset(truth).header;
    const digest = {
      model: "lstm-gaussian",
      weights_sha256: fileDigest(join(weights, "weights.bin")),
      manifest_sha256: fileDigest(join(weights, "manifest.json")),
      model_json_sha256: fileDigest(join(weights, "model.json")),
    };
    const record = (over: Record<string, unknown> = {}) => ({
      phase_a_experiment: "x",
      stalled: false,
      change: "x",
      rationale: "x",
      carried_set_rule: "x",
      decided_at: "2026-11-05T00:00:00Z",
      git_commit: "abc",
      plans: ["configs/x/plan.json"],
      test_seed: header.dataset_seed,
      reference_estimator: `cusum-mean-${immName(REF)}-c0.5-x3`,
      carried_models: [`disagree-lstm-gaussian-${immName(REF)}`],
      detector_thresholds: [
        { detector: `cusum-mean-${immName(REF)}-c0.5-x3`, threshold: 5 },
        { detector: `disagree-lstm-gaussian-${immName(REF)}`, threshold: 20 },
      ],
      model_digests: [digest],
      ...over,
    });
    const deps = (commit = "after") => ({
      isCommitted: () => true,
      checkDigests: () => undefined,
      precedes: (_d: string, x: string) => x === "after",
      truthHeader: () => ({ ...header, generator_git_dirty: false, generator_git_commit: commit }),
    });
    const b = () => ({
      decisionPath: decision,
      planPaths: ["configs/x/plan.json"],
      modelDirs: [weights],
      truthPath: truth,
      learned: l(),
      cusum: c(),
    });

    it("binds the frozen thresholds, detectors and models", () => {
      writeFileSync(decision, JSON.stringify(record()));
      const r = requireG6Binding(b(), deps());
      expect([r.learned, r.cusum]).toEqual([20, 5]);
    });

    it("refuses another detector, a missing threshold, unfrozen models, early data or an uncommitted decision", () => {
      writeFileSync(decision, JSON.stringify(record({ reference_estimator: "cusum-nis-x" })));
      expect(() => requireG6Binding(b(), deps())).toThrow(/reference detector/);
      writeFileSync(
        decision,
        JSON.stringify(record({ carried_models: ["crate-lstm-gaussian-w6"] })),
      );
      expect(() => requireG6Binding(b(), deps())).toThrow(/carries/);
      writeFileSync(decision, JSON.stringify(record({ detector_thresholds: [] })));
      expect(() => requireG6Binding(b(), deps())).toThrow(/no threshold/);
      writeFileSync(decision, JSON.stringify(record({ model_digests: [] })));
      expect(() => requireG6Binding(b(), deps())).toThrow(/model_digests/);
      writeFileSync(decision, JSON.stringify(record()));
      expect(() => requireG6Binding(b(), deps("before"))).toThrow(/does not descend/);
      expect(() => requireG6Binding(b(), { ...deps(), isCommitted: () => false })).toThrow(
        /committed/,
      );
    });

    it("a test split needs the bindings; a validation split is a diagnostic", () => {
      expect(() =>
        g6([
          "--truth",
          truth,
          "--learned",
          learnedOut,
          "--cusum",
          cusumOut,
          "--experiment",
          join(dir, "e"),
        ]),
      ).toThrow(/needs --decision, --plan and --model/);
      const val = join(dir, "validation.f32pack");
      const vt2 = join(dir, "vt2.ndjson");
      const vs = Array.from(scenarioSource(val));
      const w = openPredictionWriter(vt2, "lstm-gaussian", "per_timestep", val);
      for (const s of vs) w.write(network(s));
      w.commit();
      const vc = join(dir, "vcusum.ndjson");
      const vl = join(dir, "vcrate.ndjson");
      expect(
        runCli(detect, [
          "--truth",
          val,
          "--out",
          vc,
          "--detector",
          "cusum",
          ...IMM_ARGS,
          "--kind",
          "nis",
          "--c",
          "1",
          "--clip",
          "2",
        ]),
      ).toBe(0);
      expect(
        runCli(detect, [
          "--truth",
          val,
          "--out",
          vl,
          "--detector",
          "crate",
          "--network",
          vt2,
          "--window",
          "6",
        ]),
      ).toBe(0);
      const exp = join(dir, "val-exp");
      expect(
        runCli(g6, ["--truth", val, "--learned", vl, "--cusum", vc, "--experiment", exp]),
      ).toBe(0);
      const cal = JSON.parse(readFileSync(join(exp, "calibration.json"), "utf8")) as {
        learned: { false_alarms_per_hour: number }[];
      };
      expect(cal.learned[0]?.false_alarms_per_hour).toBeLessThanOrEqual(0.5);
      expect(
        runCli(g6, ["--truth", val, "--learned", vl, "--cusum", vc, "--experiment", exp]),
      ).not.toBe(0);
    });
  });
});
