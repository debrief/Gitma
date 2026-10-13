import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "@tma/data";
import { describe, expect, it, vi } from "vitest";
import { main as naive } from "../../classical/src/cli-naive.js";
import { main as solve } from "../../classical/src/cli-solve.js";
import { main as generate } from "../../data/src/cli-generate.js";
import { main as evalCli } from "../src/cli-eval.js";
import { main as g0 } from "../src/cli-g0.js";
import { main as gate } from "../src/cli-gate.js";

vi.spyOn(process.stdout, "write").mockImplementation(() => true);
vi.spyOn(process.stderr, "write").mockImplementation(() => true);

const GOLDEN = new URL("./golden/", import.meta.url);

function pipeline(noiseFree: boolean): { dir: string; exp: string } {
  const dir = mkdtempSync(join(tmpdir(), "tma-eval-"));
  const args = ["--seed", "1", "--count", "40", "--out", dir, "--allow-dirty"];
  expect(runCli(generate, noiseFree ? [...args, "--noise-free"] : args)).toBe(0);
  const test = join(dir, "test.f32pack");
  expect(
    runCli(naive, ["fit", "--train", join(dir, "train.f32pack"), "--out", join(dir, "naive.json")]),
  ).toBe(0);
  expect(
    runCli(naive, [
      "predict",
      "--model",
      join(dir, "naive.json"),
      "--in",
      test,
      "--out",
      join(dir, "naive.ndjson"),
    ]),
  ).toBe(0);
  expect(
    runCli(naive, [
      "predict",
      "--model",
      join(dir, "naive.json"),
      "--in",
      test,
      "--out",
      join(dir, "naive-pt.ndjson"),
      "--per-timestep",
    ]),
  ).toBe(0);
  expect(runCli(solve, ["--in", test, "--out", join(dir, "classical.ndjson")])).toBe(0);
  expect(
    runCli(solve, ["--in", test, "--out", join(dir, "classical-pt.ndjson"), "--per-timestep"]),
  ).toBe(0);
  return { dir, exp: join(dir, "exp") };
}

describe("tma-eval", () => {
  const { dir, exp } = pipeline(false);
  const test = join(dir, "test.f32pack");

  it("refuses to report without naive and classical predictions (FR-019)", () => {
    expect(
      runCli(evalCli, [
        "--truth",
        test,
        "--pred",
        join(dir, "classical.ndjson"),
        "--experiment",
        exp,
      ]),
    ).toBe(2);
    expect(existsSync(join(exp, "metrics.csv"))).toBe(false);
  });

  it("rejects predictions made from a different truth file", () => {
    const other = join(dir, "train.f32pack");
    const preds = ["--pred", join(dir, "naive.ndjson"), "--pred", join(dir, "classical.ndjson")];
    expect(runCli(evalCli, ["--truth", other, ...preds, "--experiment", exp])).toBe(2);
  });

  it("golden: metrics and curves are byte-identical", () => {
    const preds = ["naive", "naive-pt", "classical", "classical-pt"].flatMap((p) => [
      "--pred",
      join(dir, `${p}.ndjson`),
    ]);
    expect(runCli(evalCli, ["--truth", test, ...preds, "--experiment", exp])).toBe(0);
    for (const f of ["metrics.csv", "metrics.json", "curves.csv"]) {
      const got = readFileSync(join(exp, f), "utf8");
      if (process.env.UPDATE_GOLDEN === "1") writeFileSync(new URL(f, GOLDEN), got);
      expect(got === readFileSync(new URL(f, GOLDEN), "utf8"), f).toBe(true);
    }
    // G0/G1 runs (no --bootstrap, no --compare-to) write no new files.
    expect(existsSync(join(exp, "bootstrap.json"))).toBe(false);
    expect(existsSync(join(exp, "comparison.csv"))).toBe(false);
  });

  const preds = ["naive", "naive-pt", "classical", "classical-pt"].flatMap((p) => [
    "--pred",
    join(dir, `${p}.ndjson`),
  ]);
  const g2exp = join(dir, "exp-g2");

  it("golden: --bootstrap and --compare-to outputs are byte-identical", () => {
    const args = ["--truth", test, ...preds, "--experiment", g2exp, "--points", "300,600"];
    const extra = ["--bootstrap", "200", "--bootstrap-seed", "7"];
    expect(runCli(evalCli, [...args, ...extra, "--compare-to", "classical:per_timestep"])).toBe(0);
    for (const f of ["bootstrap.json", "comparison.csv"]) {
      const got = readFileSync(join(g2exp, f), "utf8");
      if (process.env.UPDATE_GOLDEN === "1") writeFileSync(new URL(f, GOLDEN), got);
      expect(got === readFileSync(new URL(f, GOLDEN), "utf8"), f).toBe(true);
    }
    expect(existsSync(join(g2exp, "comparison.json"))).toBe(true);
    expect(runCli(evalCli, [...args, "--compare-to", "nope"])).toBe(2);
    expect(runCli(evalCli, [...args, "--bootstrap", "0"])).toBe(1);
    expect(runCli(evalCli, [...args, "--bootstrap-seed", "1"])).toBe(1);
  });

  it("tma-gate g2 writes a G2 verdict from metrics, curves and bootstrap.json", () => {
    // Baselines stand in for the models: this exercises the wiring, not a result.
    const ids = [
      "--instantaneous",
      "classical",
      "--time-late",
      "classical",
      "--causal-control",
      "naive",
      "--mlp-control",
      "naive",
      "--shuffled",
      "naive",
    ];
    const base = ["g2", "--experiment", g2exp, ...ids, "--slice", "overall"];
    expect(runCli(gate, base)).toBe(0);
    // A non-default slice is a diagnostic: it never writes verdict.json (G0 panel red team).
    expect(existsSync(join(g2exp, "verdict.json"))).toBe(false);
    const v = JSON.parse(
      readFileSync(join(g2exp, "verdict-diagnostic-overall-300-600.json"), "utf8"),
    ) as {
      gate: string;
      result: string;
      checks: { name: string; threshold?: number }[];
    };
    expect(v.gate).toBe("G2");
    expect(["pass", "fail", "inconclusive"]).toContain(v.result);
    expect(v.checks).toHaveLength(12);
    expect(v.checks[2]).toMatchObject({ name: "g2-instantaneous-speed", threshold: 1 });
    // Without zig+900s metrics the gate refuses; without bootstrap.json too.
    expect(runCli(gate, [...base, "--speed-point", "zig+900s"])).toBe(2);
    expect(runCli(gate, [...base, "--point", "300"])).toBe(1);
    expect(runCli(gate, ["g2", "--experiment", exp, ...ids, "--slice", "overall"])).toBe(2);
  });
});

describe("tma-g0 and tma-gate", () => {
  it("passes G0 on noise-free data and writes a golden verdict", () => {
    const { dir, exp } = pipeline(true);
    expect(runCli(g0, ["--data", dir, "--experiment", exp, "--allow-dirty"])).toBe(0);
    const verdict = readFileSync(join(exp, "verdict.json"), "utf8");
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(new URL("verdict.json", GOLDEN), verdict);
    expect(verdict === readFileSync(new URL("verdict.json", GOLDEN), "utf8")).toBe(true);
    for (const f of ["manifest.json", "metrics.csv", "metrics.json", "seeds.txt"]) {
      expect(existsSync(join(exp, f)), f).toBe(true);
    }
  });

  it("tma-gate fails G0 when the truth set is noisy", () => {
    const { dir, exp } = pipeline(false);
    const test = join(dir, "test.f32pack");
    const preds = ["--pred", join(dir, "naive.ndjson"), "--pred", join(dir, "classical.ndjson")];
    expect(runCli(evalCli, ["--truth", test, ...preds, "--experiment", exp])).toBe(0);
    const m = join(exp, "metrics.json");
    expect(
      runCli(gate, [
        "g0",
        "--experiment",
        exp,
        "--truth",
        test,
        "--noise-free-pred",
        join(dir, "classical.ndjson"),
        "--naive-a",
        m,
        "--naive-b",
        m,
      ]),
    ).toBe(0);
    const v = JSON.parse(readFileSync(join(exp, "verdict.json"), "utf8")) as { result: string };
    expect(v.result).toBe("fail");
  });
});
