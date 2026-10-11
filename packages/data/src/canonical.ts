/**
 * Canonical JSON: object keys sorted, no whitespace, JS shortest round-trip numbers.
 * Used for every record written, so a scenario serialises to the same bytes whichever
 * format or reader it came through (zod re-orders keys on parse).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
    const obj = v as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
    return sorted;
  });
}
