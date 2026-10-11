// Results review (spec 002 US5, research R9): verdict, error-vs-time curves and sliced tables for
// the latest experiment of a gate, read at build time from experiments/<id>/ (scripts/prebuild.mjs).
import { useState } from "react";
import results from "../generated/results.json";

const METRICS = {
  range_rel_median: { label: "Median range error", fmt: (v) => `${(100 * v).toFixed(1)}%` },
  range_rel_p90: { label: "P90 range error", fmt: (v) => `${(100 * v).toFixed(1)}%` },
  course_deg_median: { label: "Median course error", fmt: (v) => `${v.toFixed(1)}°` },
  speed_kt_median: { label: "Median speed error", fmt: (v) => `${v.toFixed(2)} kt` },
  gross_error_rate: { label: "Gross-error rate", fmt: (v) => `${(100 * v).toFixed(1)}%` },
};

const COLOURS = ["#1f5f8b", "#c0392b", "#27ae60", "#8e44ad", "#d35400", "#7f8c8d", "#16a085"];
const name = (label) => label.replace(/:per_timestep$/, "");
/** CSS class for a gate or check result (pass / fail / inconclusive). */
const resultClass = (r) => `gate-${r}`;

const fmtCell = (key, v) => (v === null || v === undefined ? "–" : METRICS[key].fmt(v));

function Curves({ curves }) {
  const [metric, setMetric] = useState("range_rel_median");
  const estimators = Array.from(new Set(curves.map((c) => c.estimator)));
  const pts = curves.filter((c) => c[metric] !== null);
  if (pts.length === 0) return null;
  const W = 640;
  const H = 320;
  const M = { l: 56, r: 12, t: 12, b: 40 };
  const xMax = Math.max(...pts.map((c) => c.t_since_zig_s));
  const yMax = Math.max(...pts.map((c) => c[metric])) * 1.05 || 1;
  const x = (t) => M.l + (t / xMax) * (W - M.l - M.r);
  const y = (v) => H - M.b - (v / yMax) * (H - M.t - M.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const xTicks = Array.from({ length: Math.floor(xMax / 300) + 1 }, (_, i) => i * 300);
  return (
    <div>
      <label>
        Metric:{" "}
        <select value={metric} onChange={(e) => setMetric(e.target.value)}>
          {Object.entries(METRICS).map(([k, m]) => (
            <option key={k} value={k}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${METRICS[metric].label} against time since the zig`}
        style={{ width: "100%", maxWidth: W, display: "block" }}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="currentColor" opacity="0.12" />
            <text x={M.l - 6} y={y(v) + 4} fontSize="11" textAnchor="end" fill="currentColor">
              {METRICS[metric].fmt(v)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text
            key={t}
            x={x(t)}
            y={H - M.b + 16}
            fontSize="11"
            textAnchor="middle"
            fill="currentColor"
          >
            {t / 60}
          </text>
        ))}
        <text x={(W + M.l) / 2} y={H - 6} fontSize="12" textAnchor="middle" fill="currentColor">
          minutes since the zig
        </text>
        {estimators.map((e, i) => {
          const line = pts
            .filter((c) => c.estimator === e)
            .map((c) => `${x(c.t_since_zig_s).toFixed(1)},${y(c[metric]).toFixed(1)}`)
            .join(" ");
          return (
            <polyline
              key={e}
              points={line}
              fill="none"
              stroke={COLOURS[i % COLOURS.length]}
              strokeWidth="2"
              strokeDasharray={/naive|classical/.test(e) ? "6 4" : undefined}
            />
          );
        })}
      </svg>
      <ul style={{ display: "flex", flexWrap: "wrap", gap: "1rem", listStyle: "none", padding: 0 }}>
        {estimators.map((e, i) => (
          <li key={e}>
            <span style={{ color: COLOURS[i % COLOURS.length], fontWeight: 700 }}>━</span> {name(e)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MetricsTable({ metrics, point, slice = "overall" }) {
  const rows = metrics.filter((m) => m.point === point && m.slice === slice);
  if (rows.length === 0) return <p>No metrics at {point}.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Estimator</th>
          <th>n</th>
          {Object.values(METRICS).map((m) => (
            <th key={m.label}>{m.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.estimator}>
            <td>
              <code>{name(r.estimator)}</code>
            </td>
            <td>{r.n}</td>
            {Object.keys(METRICS).map((k) => (
              <td key={k}>{fmtCell(k, r[k])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SliceTable({ metrics }) {
  const families = Array.from(
    new Set(metrics.filter((m) => m.slice !== "overall").map((m) => m.slice.split("=")[0])),
  );
  const [family, setFamily] = useState(families[0]);
  const [point, setPoint] = useState("zig+300s");
  if (families.length === 0) return null;
  const rows = metrics.filter((m) => m.point === point && m.slice.startsWith(`${family}=`));
  const slices = Array.from(new Set(rows.map((m) => m.slice)));
  const estimators = Array.from(new Set(rows.map((m) => m.estimator)));
  return (
    <div>
      <label>
        Slice:{" "}
        <select value={family} onChange={(e) => setFamily(e.target.value)}>
          {families.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </label>{" "}
      <label>
        Point:{" "}
        <select value={point} onChange={(e) => setPoint(e.target.value)}>
          <option>zig+300s</option>
          <option>final</option>
        </select>
      </label>
      <p>Median range error by slice:</p>
      <table>
        <thead>
          <tr>
            <th>Estimator</th>
            {slices.map((s) => (
              <th key={s}>{s.split("=")[1]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {estimators.map((e) => (
            <tr key={e}>
              <td>
                <code>{name(e)}</code>
              </td>
              {slices.map((s) => {
                const m = rows.find((r) => r.estimator === e && r.slice === s);
                return (
                  <td key={s}>
                    {fmtCell("range_rel_median", m?.range_rel_median)}{" "}
                    <small style={{ opacity: m && m.n < 200 ? 1 : 0.6 }}>
                      n {m?.n ?? 0}
                      {m && m.n < 200 ? " (too few to judge)" : ""}
                    </small>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Intervals({ bootstrap }) {
  const rows = Object.entries(bootstrap).filter(([, v]) => typeof v === "object" && v !== null);
  return (
    <>
      <h2>Uncertainty at the G1 point</h2>
      <p>
        Median range error of each model divided by naive's, 5 minutes after the zig, with a paired
        bootstrap 95% interval. G1 passes only if the whole interval is below 0.5; an interval that
        straddles 0.5 is <em>inconclusive</em>.
      </p>
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Ratio</th>
            <th>95% interval</th>
            <th>n</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([id, ci]) => (
            <tr key={id}>
              <td>
                <code>{id}</code>
              </td>
              <td>{ci.ratio.toFixed(3)}</td>
              <td>
                [{ci.lo.toFixed(3)}, {ci.hi.toFixed(3)}]
              </td>
              <td>{ci.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export default function ResultsReview({ gate }) {
  const run = results.find((r) => r.verdict.gate === gate);
  if (run === undefined) {
    return (
      <div className="alert alert--info">
        No {gate} experiment has been committed yet. This page fills in from{" "}
        <code>experiments/&lt;id&gt;/</code> when one is.
      </div>
    );
  }
  const v = run.verdict;
  return (
    <div>
      <p>
        Experiment{" "}
        <a href={`https://github.com/debrief/Gitma/tree/main/experiments/${run.id}`}>
          <code>{run.id}</code>
        </a>
        : machine verdict{" "}
        <strong className={resultClass(v.result)}>
          {v.gate} {v.result}
        </strong>{" "}
        ({v.decided_by}).
      </p>
      <table className="gate-table">
        <thead>
          <tr>
            <th>Check</th>
            <th>Result</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {v.checks.map((c) => (
            <tr key={c.name}>
              <td>
                <code>{c.name}</code>
              </td>
              <td className={resultClass(c.result)}>{c.result}</td>
              <td>{c.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {run.bootstrap && <Intervals bootstrap={run.bootstrap} />}
      <h2>Error against time since the zig</h2>
      <p>Dashed lines are the naive and classical baselines; test split, all scenarios.</p>
      <Curves curves={run.curves} />
      <h2>Overall, 5 minutes after the zig (the G1 point)</h2>
      <MetricsTable metrics={run.metrics} point="zig+300s" />
      <h2>Overall, end of window</h2>
      <MetricsTable metrics={run.metrics} point="final" />
      <h2>By slice</h2>
      <SliceTable metrics={run.metrics} />
      {run.heldout.length > 0 && (
        <>
          <h2>Held-out geometry (reported, not gated)</h2>
          <MetricsTable metrics={run.heldout} point="zig+300s" />
        </>
      )}
    </div>
  );
}
