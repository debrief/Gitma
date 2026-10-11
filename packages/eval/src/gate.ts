// G0 (SRD §5): classical solver recovers noise-free truth; naive baseline numbers reproduce.
import { canonicalJson } from "@tma/data";
import type {
  DatasetHeader,
  GateCheck,
  GateVerdict,
  MetricsRecord,
  Prediction,
  Scenario,
} from "@tma/types";
import { rowError } from "./errors.js";

/** SC-001 tolerances. */
export const G0_TOLERANCE = { range_rel: 1e-3, course_deg: 0.1, speed_kt: 0.01 };

const check = (name: string, pass: boolean, detail: string): GateCheck => ({
  name,
  result: pass ? "pass" : "fail",
  detail,
});

export function isNoiseFree(h: DatasetHeader): boolean {
  const r = h.parameter_ranges;
  return r.noise_sigma_rad_values.every((s) => s === 0) && r.dropout_fraction.max === 0;
}

export function checkNoiseFreeRecovery(
  header: DatasetHeader,
  truth: Iterable<Scenario>,
  classical: Map<number, Prediction>,
): GateCheck {
  const name = "classical-recovers-noise-free-truth";
  if (!isNoiseFree(header)) return check(name, false, "truth dataset is not noise-free");
  let n = 0;
  let bad = 0;
  const worst = { range_rel: 0, course_deg: 0, speed_kt: 0 };
  for (const s of truth) {
    const p = classical.get(s.metadata.index);
    const row = p?.rows.at(-1);
    if (p === undefined || row === undefined || p.mode !== "final") {
      return check(
        name,
        false,
        `missing final-mode prediction for scenario ${String(s.metadata.index)}`,
      );
    }
    const e = rowError(s, row);
    worst.range_rel = Math.max(worst.range_rel, e.range_rel);
    worst.course_deg = Math.max(worst.course_deg, e.course_deg);
    worst.speed_kt = Math.max(worst.speed_kt, e.speed_kt);
    const ok =
      row.converged &&
      e.range_rel <= G0_TOLERANCE.range_rel &&
      e.course_deg <= G0_TOLERANCE.course_deg &&
      e.speed_kt <= G0_TOLERANCE.speed_kt;
    if (!ok) bad++;
    n++;
  }
  const detail =
    `${String(n - bad)}/${String(n)} scenarios within tolerance ` +
    `(range ${String(G0_TOLERANCE.range_rel)}, course ${String(G0_TOLERANCE.course_deg)}°, ` +
    `speed ${String(G0_TOLERANCE.speed_kt)} kt); worst range ${worst.range_rel.toExponential(2)}, ` +
    `course ${worst.course_deg.toExponential(2)}°, speed ${worst.speed_kt.toExponential(2)} kt`;
  return check(name, n > 0 && bad === 0, detail);
}

export function checkNaiveReproducible(a: MetricsRecord[], b: MetricsRecord[]): GateCheck {
  const pick = (m: MetricsRecord[]) => canonicalJson(m.filter((r) => r.estimator === "naive"));
  const same = a.some((r) => r.estimator === "naive") && pick(a) === pick(b);
  return check(
    "naive-baseline-reproduces",
    same,
    same
      ? "two in-process naive fits gave identical metrics (determinism only; cross-process and cross-commit reproduction is shown by re-running G0 from the manifest)"
      : "naive metrics differ between runs",
  );
}

export function g0Verdict(checks: GateCheck[]): GateVerdict {
  return {
    gate: "G0",
    result: checks.every((c) => c.result === "pass") ? "pass" : "fail",
    checks,
    decided_by: "harness (pending agent panel review)",
  };
}
