// One time-series plot (spec 006 FR-004): shared time axis, cursor, gate markers, a shaded turn.
import { type JSX, type PointerEvent, type Ref, useCallback } from "react";
import { C, FONT } from "./style.js";

export interface Line {
  label: string;
  values: readonly (number | null)[];
  color: string;
  dash?: string | undefined;
  /** Draw as dots (observed bearings) rather than a line. */
  dots?: boolean;
  /** Break the line where it jumps by more than half this period (angles: 360). */
  wrap?: number | undefined;
  width?: number | undefined;
}

export interface Marker {
  t: number;
  label: string;
}

export interface TimePlotProps {
  title: string;
  unit: string;
  t: readonly number[];
  lines: readonly Line[];
  cursorT: number;
  windowS: number;
  markers?: readonly Marker[];
  /** Shaded spans (ownship turns), seconds. */
  shade?: readonly (readonly [number, number])[];
  /** Grey band from 0 to this time, labelled unobservable (estimates before the zig). */
  unobservableUntil?: number | null;
  /** Fixed y range (angles); otherwise from the data. */
  yRange?: readonly [number, number];
  yTicks?: readonly number[];
  onCursor?: (t: number) => void;
  svgRef?: Ref<SVGSVGElement>;
}

const W = 640;
const H = 150;
const L = 48;
const R = 10;
const T = 22;
const B = 22;

function niceTicks(lo: number, hi: number, n = 4): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  const step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step)
    out.push(Number(v.toPrecision(12)));
  return out;
}

/** Tick label with as many decimals as the tick step needs. */
const fmt = (v: number, step: number): string =>
  v.toFixed(step > 0 && step < 1 ? Math.min(3, Math.ceil(-Math.log10(step) - 1e-9)) : 0);

export function TimePlot(props: TimePlotProps): JSX.Element {
  const { t, lines, cursorT, windowS, onCursor } = props;
  let lo = Infinity;
  let hi = -Infinity;
  if (props.yRange !== undefined) [lo, hi] = props.yRange;
  else {
    for (const l of lines)
      for (const v of l.values)
        if (v !== null && Number.isFinite(v)) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
    if (!Number.isFinite(lo)) [lo, hi] = [0, 1];
    if (hi - lo < 1e-9) [lo, hi] = [lo - 1, hi + 1];
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
  }
  const x = (s: number): number => L + ((W - L - R) * s) / Math.max(windowS, 1);
  const y = (v: number): number =>
    T + ((H - T - B) * (hi - Math.min(hi, Math.max(lo, v)))) / (hi - lo);
  const ticks = props.yTicks ?? niceTicks(lo, hi);
  const tickStep = ticks.length > 1 ? (ticks[1] ?? 0) - (ticks[0] ?? 0) : 1;
  const tTicks = niceTicks(0, windowS / 60, 6).filter((m) => m * 60 <= windowS);

  const pick = useCallback(
    (e: PointerEvent<SVGSVGElement>): void => {
      if (onCursor === undefined) return;
      const r = e.currentTarget.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const s = ((px - L) / (W - L - R)) * windowS;
      onCursor(Math.min(windowS, Math.max(0, s)));
    },
    [onCursor, windowS],
  );

  const paths = lines.map((l) => {
    if (l.dots === true) {
      return (
        <g key={l.label} fill={l.color}>
          {l.values.map((v, i) =>
            v === null || !Number.isFinite(v) ? null : (
              <circle key={i} cx={x(t[i] ?? 0)} cy={y(v)} r={1.6} />
            ),
          )}
        </g>
      );
    }
    const segs: string[] = [];
    let cur = "";
    let prev: number | null = null;
    l.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        if (cur !== "") segs.push(cur);
        cur = "";
        prev = null;
        return;
      }
      const brk = prev !== null && l.wrap !== undefined && Math.abs(v - prev) > l.wrap / 2;
      if (brk && cur !== "") {
        segs.push(cur);
        cur = "";
      }
      cur += `${cur === "" ? "M" : "L"}${x(t[i] ?? 0).toFixed(1)},${y(v).toFixed(1)}`;
      prev = v;
    });
    if (cur !== "") segs.push(cur);
    return (
      <path
        key={l.label}
        d={segs.join("")}
        fill="none"
        stroke={l.color}
        strokeWidth={l.width ?? 1.6}
        strokeDasharray={l.dash}
      />
    );
  });

  return (
    <svg
      ref={props.svgRef}
      className="tmav-svg"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={props.title}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) pick(e);
      }}
      style={{ fontFamily: FONT }}
    >
      <rect width={W} height={H} fill={C.paper} />
      {props.unobservableUntil != null && (
        <g>
          <rect
            x={L}
            y={T}
            width={Math.max(0, x(props.unobservableUntil) - L)}
            height={H - T - B}
            fill={C.muted}
            opacity={0.08}
          />
          <text x={L + 4} y={H - B - 4} fontSize={9} fill={C.muted}>
            unobservable
          </text>
        </g>
      )}
      {(props.shade ?? []).map(([a, b]) => (
        <rect
          key={`shade${String(a)}`}
          x={x(a)}
          y={T}
          width={Math.max(0, x(b) - x(a))}
          height={H - T - B}
          fill={C.turn}
          opacity={0.12}
        />
      ))}
      {ticks.map((v) => (
        <g key={`y${v}`}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={C.grid} />
          <text x={L - 4} y={y(v) + 4} fontSize={10} textAnchor="end" fill={C.muted}>
            {fmt(v, tickStep)}
          </text>
        </g>
      ))}
      {tTicks.map((m) => (
        <g key={`t${m}`}>
          <line x1={x(m * 60)} x2={x(m * 60)} y1={T} y2={H - B} stroke={C.grid} />
          <text x={x(m * 60)} y={H - 6} fontSize={10} textAnchor="middle" fill={C.muted}>
            {m}
          </text>
        </g>
      ))}
      {(props.markers ?? []).map((mk) => (
        <g key={mk.label}>
          <line x1={x(mk.t)} x2={x(mk.t)} y1={T} y2={H - B} stroke={C.gate} strokeDasharray="3 3" />
          <text x={x(mk.t) + 3} y={T + 9} fontSize={9} fill={C.gate}>
            {mk.label}
          </text>
        </g>
      ))}
      {paths}
      <line
        x1={x(cursorT)}
        x2={x(cursorT)}
        y1={T - 4}
        y2={H - B}
        stroke={C.cursor}
        strokeWidth={1.2}
      />
      <text x={L} y={13} fontSize={12} fontWeight={600} fill={C.ink}>
        {props.title}{" "}
        <tspan fill={C.muted} fontWeight={400}>
          ({props.unit}; time in min)
        </tspan>
      </text>
      <text x={W - R - 4} y={13} fontSize={10} textAnchor="end">
        {lines.map((l, k) => (
          <tspan key={l.label} fill={l.color}>
            {k === 0 ? "" : " · "}
            {l.label}
          </tspan>
        ))}
      </text>
    </svg>
  );
}
