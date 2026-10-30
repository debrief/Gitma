// G0 checks for generator 0.5.0 (spec 012; SRD Annex C §C.2): the target-manoeuvre kinematics and
// timing checks pass on generated phase-4 scenarios and catch hand-made faults.
import { readFileSync } from "node:fs";
import { generateScenario } from "@tma/sim";
import type { ParameterRanges, Scenario } from "@tma/types";
import { describe, expect, it } from "vitest";
import {
  kinematicFailure,
  manoeuvreTimingFailure,
  targetManoeuvreBearings,
} from "../src/g0-checks.js";

const PHASE4 = JSON.parse(
  readFileSync(new URL("../../../configs/phase4-ranges.json", import.meta.url), "utf8"),
) as ParameterRanges;

const scenarios = Array.from({ length: 200 }, (_, i) => generateScenario(5n, i, PHASE4).scenario);
const withKind = (kind: "course" | "speed"): Scenario => {
  const s = scenarios.find((x) => (x.metadata.manoeuvres ?? []).some((m) => m.kind === kind));
  if (s === undefined) throw new Error(`no scenario with a ${kind} change`);
  return structuredClone(s);
};

describe("G0 on generator 0.5.0", () => {
  it("every generated scenario passes kinematics and timing", () => {
    for (const s of scenarios) {
      expect(kinematicFailure(s), String(s.metadata.index)).toBeNull();
      expect(manoeuvreTimingFailure(s, PHASE4), String(s.metadata.index)).toBeNull();
    }
  });

  it("the known answers match the hand-computed bearings", () => {
    for (const c of targetManoeuvreBearings())
      expect(Math.abs(c.got - c.want), c.name).toBeLessThan(1e-6);
  });

  it("catches a speed change left out of the stored speeds", () => {
    const s = withKind("speed");
    const sp = (s.metadata.manoeuvres ?? []).find((m) => m.kind === "speed");
    const v0 = s.target.states[(sp?.start_index ?? 1) - 1]?.speed_mps ?? 0;
    for (const st of s.target.states) st.speed_mps = v0;
    expect(kinematicFailure(s)).toMatch(/target/);
  });

  it("catches a course change whose arc is flown at the wrong rate", () => {
    const s = withKind("course");
    const plan = s.metadata.parameters.target_manoeuvres ?? [];
    const j = plan.findIndex((m) => m.kind === "course");
    const m = plan[j];
    if (m === undefined) throw new Error("index");
    plan[j] = { ...m, rate: m.rate * 1.5 };
    expect(kinematicFailure(s)).toMatch(/target/);
  });

  it("catches a span shifted by one sample", () => {
    const s = withKind("course");
    const sp = s.metadata.manoeuvres?.[0];
    if (sp === undefined) throw new Error("index");
    sp.start_index += 1;
    sp.end_index += 1;
    expect(kinematicFailure(s)).toMatch(/target/);
  });

  it("catches a manoeuvre inside the end margin", () => {
    const s = withKind("course");
    const spans = s.metadata.manoeuvres ?? [];
    const last = spans[spans.length - 1];
    if (last === undefined) throw new Error("index");
    s.metadata.samples = last.end_index + 2;
    expect(manoeuvreTimingFailure(s, PHASE4)).toMatch(/margin/);
  });
});
