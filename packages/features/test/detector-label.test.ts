// Spec 030 (Annex H): the manoeuvre detector's label, mask, output width and decoding.
import { readFileSync } from "node:fs";
import { generateScenario } from "@tma/sim";
import type { NormalisationConstants, ParameterRanges } from "@tma/types";
import { describe, expect, it } from "vitest";
import { outputsToPrediction } from "../src/decode.js";
import { NT } from "../src/layout.js";
import {
  DETECTOR_LOOKBACK_ROWS,
  detectorLabel,
  detectorOnsetLabel,
  encodeTargets,
  outputSpec,
  outputWidth,
} from "../src/output.js";

/** Stored targets for `n` rows: course turns at row 40 (3 rows), speed changes at row 120. */
function stored(n: number): Float32Array {
  const t = new Float32Array(n * NT);
  for (let r = 0; r < n; r++) {
    const c = r < 40 ? 0 : r < 43 ? 0.1 * (r - 39) : 0.3;
    t[r * NT] = 1.5;
    t[r * NT + 1] = Math.fround(Math.sin(c));
    t[r * NT + 2] = Math.fround(Math.cos(c));
    t[r * NT + 3] = r < 120 ? 0.5 : 0.6;
  }
  return t;
}

describe("detector label (spec 030)", () => {
  const t = stored(200);
  it("is 1 for 30 rows after a course change, 0 on quiet rows, masked otherwise", () => {
    expect(detectorLabel(t, 10, NT)).toEqual({ label: 0, mask: 0 }); // no history yet
    expect(detectorLabel(t, 39, NT)).toEqual({ label: 0, mask: 1 }); // quiet
    expect(detectorLabel(t, 40, NT)).toEqual({ label: 1, mask: 1 }); // turning
    expect(detectorLabel(t, 41 + DETECTOR_LOOKBACK_ROWS, NT)).toEqual({ label: 1, mask: 1 }); // last change at 42
    expect(detectorLabel(t, 42 + DETECTOR_LOOKBACK_ROWS, NT)).toEqual({ label: 0, mask: 1 });
    expect(detectorLabel(t, 125, NT)).toEqual({ label: 0, mask: 0 }); // speed change only
    expect(detectorLabel(t, 150, NT)).toEqual({ label: 0, mask: 1 }); // quiet again
  });

  it("encodes as label and mask, with one output channel", () => {
    const spec = outputSpec({ output_parameterisation: "manoeuvre_detector" });
    expect(outputWidth(spec)).toBe(1);
    const out = new Float32Array(4);
    const norm = { speed_scale_mps: 10 } as NormalisationConstants;
    encodeTargets(t, 41 * NT, norm, spec, out, 0, NT);
    expect(Array.from(out)).toEqual([1, 1, 0, 0]);
    encodeTargets(t, 125 * NT, norm, spec, out, 0, NT);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });

  it("decodes to the probability, with no state estimate", () => {
    const ranges = JSON.parse(
      readFileSync(new URL("../../../configs/phase4-ranges.json", import.meta.url), "utf8"),
    ) as ParameterRanges;
    const s = generateScenario(3n, 0, ranges).scenario;
    const out = new Float32Array(s.metadata.samples).fill(0);
    out[s.metadata.zig_index + 1] = 2;
    const spec = outputSpec({ output_parameterisation: "manoeuvre_detector" });
    const p = outputsToPrediction(s, out, {} as NormalisationConstants, "det", undefined, spec);
    const r = p.rows[0];
    expect(r?.converged).toBe(false);
    expect(r?.p_manoeuvre).toBeCloseTo(1 / (1 + Math.exp(-2)), 6);
    expect(p.rows[1]?.p_manoeuvre).toBeCloseTo(0.5, 6);
  });
});

describe("early-alarm label (spec 031)", () => {
  const t = stored(200);
  it("is 1 only in the first onset rows after a turn begins, 0 on quiet rows, masked otherwise", () => {
    expect(detectorOnsetLabel(t, 39, NT, 12)).toEqual({ label: 0, mask: 1 }); // quiet
    expect(detectorOnsetLabel(t, 40, NT, 12)).toEqual({ label: 1, mask: 1 }); // turn begins
    expect(detectorOnsetLabel(t, 51, NT, 12)).toEqual({ label: 1, mask: 1 }); // 11 rows on
    expect(detectorOnsetLabel(t, 52, NT, 12)).toEqual({ label: 0, mask: 0 }); // past the onset
    expect(detectorOnsetLabel(t, 71, NT, 12)).toEqual({ label: 0, mask: 0 }); // still unsettled
    expect(detectorOnsetLabel(t, 72, NT, 12)).toEqual({ label: 0, mask: 1 }); // quiet again
    expect(detectorOnsetLabel(t, 125, NT, 12)).toEqual({ label: 0, mask: 0 }); // speed only
    expect(detectorOnsetLabel(t, 10, NT, 12)).toEqual({ label: 0, mask: 0 }); // no history
  });

  it("is chosen by detector_onset_rows, which must lie in 1..30", () => {
    const spec = outputSpec({
      output_parameterisation: "manoeuvre_detector",
      detector_onset_rows: 12,
    });
    expect(spec.detectorOnsetRows).toBe(12);
    const out = new Float32Array(4);
    const norm = { speed_scale_mps: 10 } as NormalisationConstants;
    encodeTargets(t, 60 * NT, norm, spec, out, 0, NT);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]); // the window label would give 1, 1
    expect(() =>
      outputSpec({ output_parameterisation: "manoeuvre_detector", detector_onset_rows: 0 }),
    ).toThrow();
    expect(() =>
      outputSpec({ output_parameterisation: "manoeuvre_detector", detector_onset_rows: 31 }),
    ).toThrow();
  });
});
