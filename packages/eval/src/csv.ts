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
