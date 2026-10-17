// The plan view (spec 006 FR-003): equal aspect, north up, pan and zoom, a labelled 1–2–5 grid,
// both tracks with the turn and zig marked, observed bearing rays up to the cursor, headings, and
// in model modes the estimates. Everything is drawn in fixed pixel coordinates through a
// world → pixel map, so text and markers keep their size at every zoom.
import type { Prediction, PredictionRow, Scenario } from "@tma/types";
import { type JSX, type RefObject, useEffect, useRef, useState } from "react";
import type { Mode } from "../core/catalogue.js";
import { formatDistance, gridLines, gridStep } from "../core/geometry.js";
import { rowAtSample } from "../core/estimates.js";
import type { EngagementView } from "../core/view-model.js";
import { C, FONT } from "./style.js";

export interface PlanViewProps {
  s: Scenario;
  view: EngagementView;
  /** Cursor sample index. */
  cursor: number;
  mode: Mode;
  model: Prediction | null;
  classical: Prediction | null;
  trueBearings: boolean;
  svgRef: RefObject<SVGSVGElement | null>;
}

const S = 640;
const HALF = S / 2;
/** Seconds of motion the velocity vectors show. */
export const VECTOR_S = 300;

interface Viewport {
  cx: number;
  cy: number;
  /** Half the visible width, metres. */
  half: number;
}

const initial = (v: EngagementView): Viewport => ({
  cx: (v.bounds.minX + v.bounds.maxX) / 2,
  cy: (v.bounds.minY + v.bounds.maxY) / 2,
  half: (v.bounds.maxX - v.bounds.minX) / 2,
});

const f1 = (v: number): string => v.toFixed(1);

/** Polyline path through the points; null points break it. */
function pathOf(pts: readonly ([number, number] | null)[]): string {
  let d = "";
  let pen = false;
  for (const p of pts) {
    if (p === null) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${f1(p[0])},${f1(p[1])}`;
    pen = true;
  }
  return d;
}

export function PlanView(props: PlanViewProps): JSX.Element {
  const { s, view, cursor, mode, model, classical, trueBearings, svgRef } = props;
  const [vp, setVp] = useState<Viewport>(() => initial(view));
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const drag = useRef<{ x: number; y: number; vp: Viewport } | null>(null);

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const el = svgRef.current;
    if (el === null) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const sx = ((e.clientX - r.left) / r.width) * S;
      const sy = ((e.clientY - r.top) / r.height) * S;
      const v = vpRef.current;
      const k = HALF / v.half;
      const wx = v.cx + (sx - HALF) / k;
      const wy = v.cy - (sy - HALF) / k;
      const half = Math.min(2e5, Math.max(200, v.half * (e.deltaY > 0 ? 1.15 : 1 / 1.15)));
      const k2 = HALF / half;
      setVp({ cx: wx - (sx - HALF) / k2, cy: wy + (sy - HALF) / k2, half });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [svgRef]);

  const k = HALF / vp.half;
  const px = (x: number): number => HALF + (x - vp.cx) * k;
  const py = (y: number): number => HALF - (y - vp.cy) * k;
  const pt = (x: number, y: number): [number, number] => [px(x), py(y)];

  const own = s.ownship.states;
  const tgt = s.target.states;
  const n = s.metadata.samples;
  const zig = s.metadata.zig_index;
  const { leg1, turn, leg2, turn2, leg3 } = view.legs;
  const ownAt = (i: number): [number, number] | null => {
    const o = own[i];
    return o === undefined ? null : pt(o.x_m, o.y_m);
  };
  const seg = (a: number, b: number): string => {
    const pts: [number, number][] = [];
    for (let i = Math.max(0, a); i < Math.min(n, b); i++) {
      const p = ownAt(i);
      if (p !== null) pts.push(p);
    }
    return pathOf(pts);
  };

  // Grid at the current zoom.
  const step = gridStep(2 * vp.half);
  const xs = gridLines(vp.cx - vp.half, vp.cx + vp.half, step);
  const ys = gridLines(vp.cy - vp.half, vp.cy + vp.half, step);

  // Observed bearing rays up to the cursor (dropouts omitted).
  const rayLen = 4 * Math.max(view.bounds.maxX - view.bounds.minX, 2 * vp.half);
  let lastRay = -1;
  const rays: string[] = [];
  for (let i = 0; i <= cursor && i < n; i++) {
    const o = own[i];
    const b = s.observations[i];
    if (o === undefined || b === undefined || !b.valid) continue;
    lastRay = i;
    rays.push(
      `M${f1(px(o.x_m))},${f1(py(o.y_m))}L${f1(px(o.x_m + rayLen * Math.sin(b.bearing_rad)))},${f1(py(o.y_m + rayLen * Math.cos(b.bearing_rad)))}`,
    );
  }
  const curRay = lastRay >= 0 ? rays[rays.length - 1] : undefined;

  const oc = own[cursor];
  const tc = tgt[cursor];
  const heading = (x: number, y: number, c: number, color: string, key: string): JSX.Element => {
    const [hx, hy] = pt(x, y);
    const dx = Math.sin(c);
    const dy = -Math.cos(c);
    const tip = `${f1(hx + dx * 11)},${f1(hy + dy * 11)}`;
    const l = `${f1(hx - dx * 5 + dy * 5)},${f1(hy - dy * 5 - dx * 5)}`;
    const r = `${f1(hx - dx * 5 - dy * 5)},${f1(hy - dy * 5 + dx * 5)}`;
    return (
      <polygon
        key={key}
        points={`${tip} ${l} ${r}`}
        fill={color}
        stroke={C.paper}
        strokeWidth={1}
      />
    );
  };

  const estPoint = (r: PredictionRow | null): [number, number] | null =>
    r === null || !r.converged ? null : pt(r.x_m, r.y_m);
  const vector = (r: PredictionRow, color: string, key: string): JSX.Element => {
    const a = pt(r.x_m, r.y_m);
    const b = pt(
      r.x_m + r.speed_mps * VECTOR_S * Math.sin(r.course_rad),
      r.y_m + r.speed_mps * VECTOR_S * Math.cos(r.course_rad),
    );
    return (
      <line
        key={key}
        x1={a[0]}
        y1={a[1]}
        x2={b[0]}
        y2={b[1]}
        stroke={color}
        strokeWidth={2}
        markerEnd={`url(#tmav-arrow-${key})`}
      />
    );
  };

  const modelRow = rowAtSample(model, s, cursor);
  const classRow = rowAtSample(classical, s, cursor);
  const estimates: JSX.Element[] = [];
  if (mode !== "truth") {
    // Trail (instantaneous, up to the cursor) or track (time-late, the whole window).
    const trail = (p: Prediction | null, color: string, key: string, dots: boolean): void => {
      if (p === null) return;
      const pre: ([number, number] | null)[] = [];
      const post: ([number, number] | null)[] = [];
      const dt = s.metadata.parameters.dt_s;
      for (const r of p.rows) {
        const i = Math.round(r.timestamp_s / dt);
        if (mode === "instantaneous" && i > cursor) break;
        const q = estPoint(r);
        (i <= zig ? pre : post).push(q);
      }
      if (dots) {
        estimates.push(
          <g key={`${key}-dots`} fill={color}>
            {pre.map((q, j) =>
              q === null ? null : (
                <circle key={`a${String(j)}`} cx={q[0]} cy={q[1]} r={1.8} opacity={0.3} />
              ),
            )}
            {post.map((q, j) =>
              q === null ? null : (
                <circle key={`b${String(j)}`} cx={q[0]} cy={q[1]} r={2} opacity={0.8} />
              ),
            )}
          </g>,
        );
      } else {
        estimates.push(
          <path
            key={`${key}-pre`}
            d={pathOf(pre)}
            fill="none"
            stroke={color}
            strokeWidth={1.4}
            opacity={0.35}
          />,
          <path key={`${key}-post`} d={pathOf(post)} fill="none" stroke={color} strokeWidth={2} />,
        );
      }
    };
    if (mode === "instantaneous") {
      trail(model, C.model, "model", true);
      if (classical !== null) trail(classical, C.classical, "classical", true);
    } else {
      trail(model, C.model, "model", false);
      if (classical !== null) trail(classical, C.classical, "classical", false);
    }
    if (modelRow?.converged === true && oc !== undefined) {
      const [ox, oy] = pt(oc.x_m, oc.y_m);
      if (mode === "instantaneous") {
        estimates.push(
          <circle
            key="ring"
            cx={ox}
            cy={oy}
            r={modelRow.range_m * k}
            fill="none"
            stroke={C.model}
            strokeDasharray="5 4"
            opacity={0.7}
          />,
        );
      }
      estimates.push(vector(modelRow, C.model, "model"));
      const q = estPoint(modelRow);
      if (q !== null)
        estimates.push(
          <circle key="model-at" cx={q[0]} cy={q[1]} r={5} fill={C.model} stroke={C.paper} />,
        );
    }
    if (classRow?.converged === true) {
      estimates.push(vector(classRow, C.classical, "classical"));
      const q = estPoint(classRow);
      if (q !== null)
        estimates.push(
          <rect
            key="classical-at"
            x={q[0] - 4}
            y={q[1] - 4}
            width={8}
            height={8}
            fill={C.classical}
            stroke={C.paper}
          />,
        );
    }
  }

  // Zig markers at the first sample on each new leg.
  const zigMarks: [string, [number, number]][] = [];
  for (const [label, k] of [
    ["zig", zig],
    ["zig 2", s.metadata.zig2_index],
  ] as const) {
    const q = k == null ? null : ownAt(k);
    if (q !== null) zigMarks.push([label, q]);
  }
  const ownStart = ownAt(0);
  const tgtStart = tgt[0] === undefined ? null : pt(tgt[0].x_m, tgt[0].y_m);
  const tgtPath = pathOf(tgt.map((p) => pt(p.x_m, p.y_m)));

  const legend: [string, string, string?][] = [
    ["ownship", C.own],
    ["turn", C.turn],
    ["target", C.target],
    ["bearings", C.bearing],
  ];
  if (trueBearings) legend.push(["true bearing", C.trueBearing, "4 3"]);
  if (mode !== "truth") {
    legend.push(["model", C.model]);
    if (classical !== null) legend.push(["classical", C.classical]);
  }

  return (
    <svg
      ref={svgRef}
      className="tmav-svg"
      viewBox={`0 0 ${String(S)} ${String(S)}`}
      role="img"
      aria-label="Plan view"
      style={{ fontFamily: FONT, aspectRatio: "1 / 1", cursor: "grab" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, vp };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d === null || e.buttons !== 1) return;
        const r = e.currentTarget.getBoundingClientRect();
        const scale = S / r.width / (HALF / d.vp.half);
        setVp({
          ...d.vp,
          cx: d.vp.cx - (e.clientX - d.x) * scale,
          cy: d.vp.cy + (e.clientY - d.y) * scale,
        });
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onDoubleClick={() => {
        setVp(initial(view));
      }}
    >
      <defs>
        <clipPath id="tmav-clip">
          <rect width={S} height={S} />
        </clipPath>
        {[
          ["model", C.model],
          ["classical", C.classical],
        ].map(([id, color]) => (
          <marker
            key={id}
            id={`tmav-arrow-${String(id)}`}
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={7}
            markerHeight={7}
            orient="auto-start-reverse"
          >
            <path d="M0,0L10,5L0,10z" fill={color} />
          </marker>
        ))}
      </defs>
      <rect width={S} height={S} fill={C.paper} />
      <g clipPath="url(#tmav-clip)">
        <g stroke={C.grid} strokeWidth={1}>
          {xs.map((x) => (
            <line
              key={`gx${String(x)}`}
              x1={px(x)}
              x2={px(x)}
              y1={0}
              y2={S}
              stroke={x === 0 ? C.gridMajor : C.grid}
            />
          ))}
          {ys.map((y) => (
            <line
              key={`gy${String(y)}`}
              y1={py(y)}
              y2={py(y)}
              x1={0}
              x2={S}
              stroke={y === 0 ? C.gridMajor : C.grid}
            />
          ))}
        </g>
        <path d={rays.join("")} stroke={C.bearing} strokeWidth={0.6} opacity={0.18} />
        {curRay !== undefined && (
          <path d={curRay} stroke={C.bearing} strokeWidth={1.4} opacity={0.8} />
        )}
        {trueBearings && oc !== undefined && tc !== undefined && (
          <line
            x1={px(oc.x_m)}
            y1={py(oc.y_m)}
            x2={px(tc.x_m)}
            y2={py(tc.y_m)}
            stroke={C.trueBearing}
            strokeWidth={1.4}
            strokeDasharray="4 3"
          />
        )}
        <path d={tgtPath} fill="none" stroke={C.target} strokeWidth={2} />
        <path d={seg(leg1[0], leg1[1] + 1)} fill="none" stroke={C.own} strokeWidth={2} />
        <path d={seg(turn[0] - 1, turn[1] + 1)} fill="none" stroke={C.turn} strokeWidth={2.4} />
        <path d={seg(leg2[0], leg2[1] + 1)} fill="none" stroke={C.own} strokeWidth={2} />
        {turn2 !== undefined && (
          <path d={seg(turn2[0] - 1, turn2[1] + 1)} fill="none" stroke={C.turn} strokeWidth={2.4} />
        )}
        {leg3 !== undefined && (
          <path d={seg(leg3[0], leg3[1])} fill="none" stroke={C.own} strokeWidth={2} />
        )}
        {estimates}
        {ownStart !== null && (
          <circle
            cx={ownStart[0]}
            cy={ownStart[1]}
            r={4}
            fill={C.paper}
            stroke={C.own}
            strokeWidth={2}
          />
        )}
        {tgtStart !== null && (
          <circle
            cx={tgtStart[0]}
            cy={tgtStart[1]}
            r={4}
            fill={C.paper}
            stroke={C.target}
            strokeWidth={2}
          />
        )}
        {zigMarks.map(([label, q]) => (
          <g key={label}>
            <rect
              x={q[0] - 5}
              y={q[1] - 5}
              width={10}
              height={10}
              transform={`rotate(45 ${f1(q[0])} ${f1(q[1])})`}
              fill={C.turn}
              stroke={C.paper}
            />
            <text x={q[0] + 9} y={q[1] - 7} fontSize={11} fill={C.turn}>
              {label}
            </text>
          </g>
        ))}
        {oc !== undefined && heading(oc.x_m, oc.y_m, oc.course_rad, C.own, "own")}
        {tc !== undefined && heading(tc.x_m, tc.y_m, tc.course_rad, C.target, "tgt")}
      </g>
      <g fontSize={10} fill={C.muted}>
        {xs.map((x) => (
          <text key={`lx${String(x)}`} x={px(x) + 2} y={S - 4}>
            {formatDistance(x)}
          </text>
        ))}
        {ys.map((y) => (
          <text key={`ly${String(y)}`} x={3} y={py(y) - 2}>
            {formatDistance(y)}
          </text>
        ))}
      </g>
      <g transform={`translate(${String(S - 24)} 40)`} fill={C.ink}>
        <path d="M0,-22L6,-6L0,-10L-6,-6z" />
        <text y={4} fontSize={12} textAnchor="middle" fontWeight={600}>
          N
        </text>
      </g>
      <g fontSize={11}>
        <rect
          x={0}
          y={6}
          width={158}
          height={18 + legend.length * 15}
          fill={C.paper}
          opacity={0.85}
          rx={4}
        />
        <text x={12} y={20} fill={C.ink} fontWeight={600}>
          grid {formatDistance(step)}
        </text>
        {legend.map(([label, color, dash], j) => (
          <g key={label} transform={`translate(12 ${String(32 + j * 15)})`}>
            <line
              x1={0}
              x2={18}
              y1={-4}
              y2={-4}
              stroke={color}
              strokeWidth={2.4}
              strokeDasharray={dash}
            />
            <text x={24} fill={C.ink}>
              {label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
