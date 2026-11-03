// Settings from estimator names (spec 015 FR-001): every parse round-trips, and anything else is
// refused (null).
import { describe, expect, it } from "vitest";
import { ekfName } from "../src/ekf.js";
import { fusedName } from "../src/fused.js";
import { trackerHybridName } from "../src/hybrid.js";
import { type ImmParams, immName } from "../src/imm.js";
import {
  parseEkfName,
  parseFusedName,
  parseImmName,
  parseTrackerHybridName,
} from "../src/names.js";

const REF: ImmParams = {
  sigmaCv: 0.01,
  sigmaCt: 0.03,
  sigmaOmega: 0.01,
  switchPerS: 0.001,
  p0Scale: 4,
  rScale: 8,
};

describe("estimator-name parsers", () => {
  it("parse the frozen references and the carried trackers of decisions 30 and 31", () => {
    expect(parseImmName("imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8")).toEqual(REF);
    expect(parseEkfName("ekf-sa0.03-p4-r8")).toEqual({
      sigmaA: 0.03,
      scales: { p0Scale: 4, rScale: 8 },
    });
    expect(
      parseFusedName(
        "fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-k4-m6",
        "lstm-gaussian",
      ),
    ).toEqual({ imm: REF, fusion: { k: 4, every: 6 } });
    expect(
      parseTrackerHybridName(
        "hybrid-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-c45",
        "lstm-gaussian",
        "imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8",
      ),
    ).toBe(45);
  });

  it("round-trip every name their namers make, including exponents and absent scales", () => {
    const imms: ImmParams[] = [
      REF,
      { sigmaCv: 0.003, sigmaCt: 0.1, sigmaOmega: 0.001, switchPerS: 0.001, rScale: 2 },
      { sigmaCv: 1e-7, sigmaCt: 2, sigmaOmega: 0, switchPerS: 1e-9 },
      { sigmaCv: 0.5, sigmaCt: 0.5, sigmaOmega: 0.5, switchPerS: 0.5, p0Scale: 0.25 },
    ];
    for (const p of imms) {
      expect(parseImmName(immName(p))).toEqual(p);
      for (const f of [
        { k: 4, every: 6 },
        { k: 0.5, every: 1 },
      ])
        expect(parseFusedName(fusedName("net-a-b", p, f), "net-a-b")).toEqual({
          imm: p,
          fusion: f,
        });
    }
    expect(parseEkfName(ekfName(1e-5, {}))).toEqual({ sigmaA: 1e-5, scales: {} });
    expect(parseTrackerHybridName(trackerHybridName("n", "t-x", 22.5), "n", "t-x")).toBe(22.5);
  });

  it("refuse names that are not canonical or not theirs", () => {
    for (const bad of [
      "imm-cv0.01-ct0.03-w0.01",
      "imm-cv0.010-ct0.03-w0.01-s0.001", // not as String() prints it
      "imm-cv0.01-ct0.03-w0.01-s0.001-p1", // a scale of 1 is never named
      "imm-cv0.01-ct0.03-w0.01-s0.001-r8-p4", // scales out of order
      "ekf-sa0.03-x",
    ]) {
      expect(parseImmName(bad)).toBeNull();
      expect(parseEkfName(bad)).toBeNull();
    }
    const fused = "fused-lstm-gaussian-imm-cv0.01-ct0.03-w0.01-s0.001-p4-r8-k4-m6";
    expect(parseFusedName(fused, "other")).toBeNull();
    expect(parseFusedName(fused.replace("-m6", "-m6.5"), "lstm-gaussian")).toBeNull();
    expect(parseFusedName(fused.replace("-k4", ""), "lstm-gaussian")).toBeNull();
    expect(parseTrackerHybridName("hybrid-n-t-c45", "n", "u")).toBeNull();
    expect(parseTrackerHybridName("hybrid-n-t-c045", "n", "t")).toBeNull();
  });
});
