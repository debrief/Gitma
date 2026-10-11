import { CurvePoint } from "@tma/types";

/** CSV with a fixed column order; missing values are empty cells. */
export function toCsv(columns: readonly string[], rows: readonly object[]): string {
  const cell = (v: unknown): string => {
    if (v === undefined || v === null) return "";
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lines = [columns.join(",")];
  for (const r of rows) {
    const rec = r as Record<string, unknown>;
    lines.push(columns.map((c) => cell(rec[c])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export const METRIC_COLUMNS = [
  "estimator",
  "slice",
  "point",
  "n",
  "excluded",
  "range_rel_median",
  "range_rel_p90",
  "course_deg_median",
  "course_deg_p90",
  "speed_kt_median",
  "speed_kt_p90",
  "gross_error_rate",
  "position_m_mean",
] as const;

export const CURVE_COLUMNS = [
  "estimator",
  "t_since_zig_s",
  "n",
  "range_rel_median",
  "range_rel_p90",
  "course_deg_median",
  "speed_kt_median",
  "gross_error_rate",
] as const;

/** Reads a curves.csv written by `toCsv(CURVE_COLUMNS, …)`; empty cells become absent. */
export function parseCurvesCsv(text: string): CurvePoint[] {
  const [head, ...lines] = text.split("\n").filter((l) => l !== "");
  if (head !== CURVE_COLUMNS.join(",")) throw new Error("curves.csv: unexpected columns");
  return lines.map((line, i) => {
    const cells = line.split(",");
    if (cells.length !== CURVE_COLUMNS.length) {
      throw new Error(
        `curves.csv line ${String(i + 2)}: expected ${String(CURVE_COLUMNS.length)} cells`,
      );
    }
    const rec: Record<string, string | number> = {};
    CURVE_COLUMNS.forEach((c, k) => {
      const v = cells[k] ?? "";
      if (v === "") return;
      rec[c] = c === "estimator" ? v : Number(v);
    });
    return CurvePoint.parse(rec);
  });
}
