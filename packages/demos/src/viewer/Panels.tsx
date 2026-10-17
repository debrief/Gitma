// Side panels (spec 006 FR-005, FR-006, US4): the readout at the cursor (truth, model, classical,
// naive and their errors), the scenario's summary errors, its parameters and provenance, and the
// chosen model pair's manifest.
import { bearingOf, mpsToKt, radToDeg } from "@tma/sim";
import type { PredictionRow, Scenario } from "@tma/types";
import type { JSX } from "react";
import type { ModelEntry, ModelPair, ScenarioSource } from "../core/catalogue.js";
import { errorOf, type ScenarioErrors } from "../core/errors.js";
import { trueBearing } from "../core/series.js";

const deg = (rad: number): number => {
  const d = radToDeg(rad) % 360;
  return d < 0 ? d + 360 : d;
};
const dash = "—";
const fx = (v: number | null | undefined, digits: number): string =>
  v === null || v === undefined || Number.isNaN(v)
    ? dash
    : v === Infinity
      ? "∞"
      : v.toFixed(digits);

export interface Estimate {
  label: string;
  color: string;
  row: PredictionRow | null;
}

export interface ReadoutProps {
  s: Scenario;
  cursor: number;
  estimates: readonly Estimate[];
}

/** Values and errors at the cursor, one column pair per estimator. */
export function Readout({ s, cursor, estimates }: ReadoutProps): JSX.Element {
  const o = s.ownship.states[cursor];
  const g = s.target.states[cursor];
  if (o === undefined || g === undefined) return <p className="tmav-warn">no sample {cursor}</p>;
  const zig = s.metadata.zig_index;
  const truth = {
    range: Math.hypot(g.x_m - o.x_m, g.y_m - o.y_m) / 1000,
    bearing: deg(trueBearing(s, cursor)),
    course: deg(g.course_rad),
    speed: mpsToKt(g.speed_mps),
  };
  const cols = estimates.map((e) => {
    const r = e.row;
    if (r === null) return { e, v: null, err: null };
    if (!r.converged) return { e, v: "nc" as const, err: null };
    return {
      e,
      v: {
        range: r.range_m / 1000,
        bearing: deg(bearingOf(r.x_m - o.x_m, r.y_m - o.y_m)),
        course: deg(r.course_rad),
        speed: mpsToKt(r.speed_mps),
      },
      err: errorOf(s, r),
    };
  });
  const bearingErr = (b: number): number => {
    const d = Math.abs(b - truth.bearing) % 360;
    return d > 180 ? 360 - d : d;
  };
  const line = (
    name: string,
    t: string,
    get: (v: { range: number; bearing: number; course: number; speed: number }) => number,
    err: (c: (typeof cols)[number]) => string,
    digits: number,
  ): JSX.Element => (
    <tr key={name}>
      <td>{name}</td>
      <td>{t}</td>
      {cols.map((c) => (
        <td key={c.e.label} style={{ color: c.e.color }}>
          {c.v === null
            ? dash
            : c.v === "nc"
              ? "not conv."
              : `${get(c.v).toFixed(digits)} (${err(c)})`}
        </td>
      ))}
    </tr>
  );
  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>at t = {(o.timestamp_s / 60).toFixed(1)} min</th>
            <th>truth</th>
            {estimates.map((e) => (
              <th key={e.label} style={{ color: e.color }}>
                {e.label} (error)
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {line(
            "range, km",
            truth.range.toFixed(2),
            (v) => v.range,
            (c) => `${fx((c.err?.range_rel ?? NaN) * 100, 0)}%`,
            2,
          )}
          {line(
            "bearing, °",
            truth.bearing.toFixed(1),
            (v) => v.bearing,
            (c) => fx(c.v !== null && c.v !== "nc" ? bearingErr(c.v.bearing) : NaN, 1),
            1,
          )}
          {line(
            "course, °",
            truth.course.toFixed(0),
            (v) => v.course,
            (c) => fx(c.err?.course_deg, 0),
            0,
          )}
          {line(
            "speed, kt",
            truth.speed.toFixed(1),
            (v) => v.speed,
            (c) => fx(c.err?.speed_kt, 1),
            1,
          )}
          <tr>
            <td>position error, m</td>
            <td />
            {cols.map((c) => (
              <td key={c.e.label} style={{ color: c.e.color }}>
                {fx(c.err?.position_m, 0)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="tmav-note">
        Ownship ({(o.x_m / 1000).toFixed(2)}, {(o.y_m / 1000).toFixed(2)}) km, course{" "}
        {deg(o.course_rad).toFixed(0)}°, speed {mpsToKt(o.speed_mps).toFixed(1)} kt
        {cursor < (s.metadata.turn_start_index ?? zig)
          ? ", leg 1"
          : cursor < zig
            ? ", turning"
            : ", leg 2"}
        .
      </p>
      {cursor <= zig && (
        <p className="tmav-warn">
          Before the zig the target&apos;s range is unobservable from bearings alone: the estimates
          here are shown but not scored.
        </p>
      )}
    </div>
  );
}

export interface SummaryProps {
  rows: readonly { label: string; color: string; e: ScenarioErrors | null }[];
}

/** Whole-scenario medians over the post-zig rows, as the gates score them. */
export function Summary({ rows }: SummaryProps): JSX.Element {
  return (
    <table>
      <thead>
        <tr>
          <th>post-zig medians</th>
          <th>range</th>
          <th>course</th>
          <th>speed</th>
          <th>mean position</th>
          <th>not conv.</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ label, color, e }) => (
          <tr key={label} style={{ color }}>
            <td>{label}</td>
            <td>{e === null ? dash : `${fx(e.rangeRelMedian * 100, 1)}%`}</td>
            <td>{e === null ? dash : `${fx(e.courseDegMedian, 1)}°`}</td>
            <td>{e === null ? dash : `${fx(e.speedKtMedian, 2)} kt`}</td>
            <td>{e === null ? dash : `${fx(e.positionMeanM, 0)} m`}</td>
            <td>{e === null ? dash : `${String(e.nonConverged)} / ${String(e.rows)}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface MetadataProps {
  s: Scenario;
  source: ScenarioSource;
  generatorVersion: string;
}

/** Parameters, derived keys and provenance (FR-005). */
export function Metadata({ s, source, generatorVersion }: MetadataProps): JSX.Element {
  const m = s.metadata;
  const p = m.parameters;
  const rate = p.ownship_turn_rate_rad_s ?? 0;
  const items: [string, string][] = [
    [
      "dataset",
      `${source.label} (seed ${source.seed}, indices ${String(source.start)}–${String(source.end - 1)})`,
    ],
    ["scenario", `index ${String(m.index)}, scenario seed ${m.seed}`],
    ["generator", generatorVersion],
    [
      "window",
      `${String(m.samples)} samples at ${String(p.dt_s)} s (${(((m.samples - 1) * p.dt_s) / 60).toFixed(1)} min)`,
    ],
    ["noise σ", `${radToDeg(p.noise_sigma_rad).toFixed(2)}°`],
    ["dropouts", `${(p.dropout_fraction * 100).toFixed(1)}%`],
    [
      "ownship",
      `${mpsToKt(p.ownship_speed_mps).toFixed(1)} kt, leg 1 course ${deg(p.ownship_course0_rad).toFixed(0)}°`,
    ],
    [
      "zig",
      `${radToDeg(p.zig_angle_rad).toFixed(0)}° at ${(m.zig_time_s / 60).toFixed(1)} min` +
        (rate > 0 ? `, turn rate ${radToDeg(rate).toFixed(2)}°/s` : ", instantaneous") +
        `, zig index ${String(m.zig_index)}`,
    ],
    [
      "target",
      `${(p.target_range0_m / 1000).toFixed(1)} km on ${deg(p.target_bearing0_rad).toFixed(0)}°, course ${deg(p.target_course_rad).toFixed(0)}°, ${mpsToKt(p.target_speed_mps).toFixed(1)} kt`,
    ],
    [
      "range",
      `mean ${(m.mean_range_m / 1000).toFixed(1)} km, min ${(m.min_range_m / 1000).toFixed(1)} km`,
    ],
  ];
  return (
    <table>
      <tbody>
        {items.map(([k, v]) => (
          <tr key={k}>
            <td>{k}</td>
            <td style={{ textAlign: "left", whiteSpace: "normal" }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface ModelInfoProps {
  pair: ModelPair;
  source: ScenarioSource;
}

const entryLine = (e: ModelEntry): string =>
  `${e.id}: ${e.architecture}, ${e.parameterCount.toLocaleString("en-GB")} parameters, ${e.featureSet} features, best epoch ${String(e.bestEpoch)}`;

/** The pair's manifest summary and a note when the scenario is not from its training dataset (US4). */
export function ModelInfo({ pair, source }: ModelInfoProps): JSX.Element {
  const seeds = [pair.instantaneous.trainedOnSeed, pair.timeLate.trainedOnSeed];
  const trained = seeds[0] ?? seeds[1];
  return (
    <div>
      <p style={{ margin: "0 0 4px" }}>
        <strong>{pair.label}</strong>: {pair.gate}, scored in <code>{pair.experiment}</code>.
      </p>
      <ul style={{ margin: "0 0 4px", paddingLeft: 20, fontSize: 13 }}>
        <li>{entryLine(pair.instantaneous)}</li>
        <li>{entryLine(pair.timeLate)}</li>
      </ul>
      {trained === null || trained === undefined ? (
        <p className="tmav-note">The manifest does not record the training dataset&apos;s seed.</p>
      ) : trained === source.seed ? (
        <p className="tmav-note">
          Trained on seed {trained}&apos;s training split; this scenario is from a split of the same
          seed that training never saw.
        </p>
      ) : (
        <p className="tmav-warn">
          Trained on seed {trained}; this scenario comes from a different dataset (seed{" "}
          {source.seed}).
        </p>
      )}
      {source.note !== undefined && <p className="tmav-warn">{source.note}</p>}
    </div>
  );
}
