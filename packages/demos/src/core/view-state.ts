// The view in the URL (spec 006 FR-002, Annex A V-017): reopening a link shows the same view.
import type { Mode, ViewerCatalogue } from "./catalogue.js";

export interface ViewState {
  source: string;
  index: number;
  mode: Mode;
  /** Cursor, seconds from window start; null = the zig + 10 min gate point (or window end). */
  t: number | null;
  pair: string;
  classical: boolean;
  /** The IMM tracker (spec 010), off by default. */
  tracker: boolean;
  trueBearings: boolean;
}

const MODES: readonly Mode[] = ["truth", "instantaneous", "time-late"];

export function encodeView(v: ViewState): string {
  const q = new URLSearchParams();
  q.set("src", v.source);
  q.set("i", String(v.index));
  q.set("mode", v.mode);
  if (v.t !== null) q.set("t", String(Math.round(v.t)));
  q.set("pair", v.pair);
  q.set("cl", v.classical ? "1" : "0");
  if (v.tracker) q.set("tr", "1");
  q.set("tb", v.trueBearings ? "1" : "0");
  return q.toString();
}

/** Parse a query string; anything missing or unknown falls back to the catalogue's defaults. */
export function decodeView(search: string, cat: ViewerCatalogue): ViewState {
  const q = new URLSearchParams(search);
  const source = cat.sources.find((s) => s.id === q.get("src")) ?? cat.sources[0];
  const pair = cat.pairs.find((p) => p.id === q.get("pair")) ?? cat.pairs.at(-1);
  if (source === undefined || pair === undefined) throw new Error("empty viewer catalogue");
  const i = Number(q.get("i"));
  const index = Number.isInteger(i) && i >= source.start && i < source.end ? i : source.start;
  const m = q.get("mode");
  const mode = MODES.find((x) => x === m) ?? "truth";
  const tRaw = q.get("t");
  const tNum = tRaw === null ? NaN : Number(tRaw);
  return {
    source: source.id,
    index,
    mode,
    t: Number.isFinite(tNum) && tNum >= 0 ? tNum : null,
    pair: pair.id,
    classical: q.get("cl") !== "0",
    tracker: q.get("tr") === "1",
    trueBearings: q.get("tb") === "1",
  };
}
