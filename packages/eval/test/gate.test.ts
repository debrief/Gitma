import { DEFAULT_RANGES } from "@tma/sim";
import type { DatasetHeader } from "@tma/types";
import { describe, expect, it } from "vitest";
import { evaluate } from "../src/evaluate.js";
import { checkNaiveReproducible, checkNoiseFreeRecovery, g0Verdict } from "../src/gate.js";
import { finalPred, NOISE_FREE, scenarios, set, truthRow } from "./helpers.js";

const header = (noiseFree: boolean): DatasetHeader => ({
  record: "header",
  schema_version: "0.2.0",
  generator_version: "0.1.0",
  dataset_seed: "1",
  split: "test",
  scenario_count: 20,
  index_start: 0,
  index_end: 20,
  parameter_ranges: noiseFree ? NOISE_FREE : DEFAULT_RANGES,
  redraw_count: 0,
  created_by: "test",
});

describe("G0 gate", () => {
  const ss = scenarios(6n, 20, NOISE_FREE);
  const perfect = new Map(
    ss.map((s) => [
      s.metadata.index,
      finalPred(s, "classical", truthRow(s, s.metadata.samples - 1)),
    ]),
  );

  it("passes when every scenario is within tolerance", () => {
    expect(checkNoiseFreeRecovery(header(true), ss, perfect).result).toBe("pass");
  });

  it("fails when one scenario exceeds tolerance", () => {
    const bad = new Map(perfect);
    const first = ss[0];
    const p = first === undefined ? undefined : bad.get(first.metadata.index);
    if (first === undefined || p === undefined) throw new Error();
    bad.set(first.metadata.index, {
      ...p,
      rows: p.rows.map((r) => ({ ...r, range_m: r.range_m * 1.01 })),
    });
    const c = checkNoiseFreeRecovery(header(true), ss, bad);
    expect(c.result).toBe("fail");
    expect(c.detail).toMatch(/^19\/20/);
  });

  it("fails when the truth set is not noise-free", () => {
    expect(checkNoiseFreeRecovery(header(false), ss, perfect).result).toBe("fail");
  });

  it("fails when naive runs differ, and the verdict reflects any failed check", () => {
    const naive = ss.map((s) =>
      finalPred(s, "naive", { ...truthRow(s, s.metadata.samples - 1), range_m: 8000 }),
    );
    const naive2 = naive.map((p) => ({ ...p, rows: p.rows.map((r) => ({ ...r, range_m: 8001 })) }));
    const a = evaluate(ss, [set("naive", naive)]).metrics;
    const b = evaluate(ss, [set("naive", naive2)]).metrics;
    expect(checkNaiveReproducible(a, a).result).toBe("pass");
    const diff = checkNaiveReproducible(a, b);
    expect(diff.result).toBe("fail");
    expect(g0Verdict([checkNoiseFreeRecovery(header(true), ss, perfect), diff]).result).toBe(
      "fail",
    );
  });
});
