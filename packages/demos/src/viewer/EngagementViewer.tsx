// The engagement and model viewer (SRD Annex A Part A, spec 006): one page, three modes.
// Truth shows the regenerated engagement; instantaneous shows the causal model's estimate at a
// "now" cursor with its trail; time-late shows the bidirectional model's whole-window track. The
// classical solver and the naive baseline sit beside every model figure (SRD §5 reporting rule).
import { mpsToKt, radToDeg } from "@tma/sim";
import type { Tensor } from "@tensorflow/tfjs-core";
import type { Prediction, PredictionRow } from "@tma/types";
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bookmark, Mode, ModelEntry, ViewerCatalogue } from "../core/catalogue.js";
import { scenarioErrors } from "../core/errors.js";
import {
  classicalTrack,
  modelPrediction,
  naiveRows,
  rowAtSample,
  trackerRows,
} from "../core/estimates.js";
import { viewNdjson } from "../core/export.js";
import { clampIndex, scenarioAt } from "../core/scenario.js";
import { sampleAt } from "../core/series.js";
import { engagementView } from "../core/view-model.js";
import { decodeView, encodeView, type ViewState } from "../core/view-state.js";
import { savePng, saveText } from "./download.js";
import { type Estimate, Metadata, ModelInfo, Readout, Summary } from "./Panels.js";
import { PlanView } from "./PlanView.js";
import { runtime } from "./runtime.js";
import { C, CSS } from "./style.js";
import { type Line, type Marker, TimePlot } from "./TimePlot.js";

export interface EngagementViewerProps {
  catalogue: ViewerCatalogue;
  /** URL of the folder holding `<model path>/model.json` and its weights. */
  modelBaseUrl: string;
  /** Query string to start from (the page's `location.search`). */
  initialSearch?: string;
  /** Keep the page URL in step with the view (FR-002). */
  syncUrl?: boolean;
}

interface Inference {
  key: string;
  prediction: Prediction | null;
  ms: number;
  error: string | null;
}

const SAVED = "tma-viewer-bookmarks";

function loadSaved(): Bookmark[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(SAVED);
    if (raw === null) return [];
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as Bookmark[]) : [];
  } catch {
    return [];
  }
}

function storeSaved(b: readonly Bookmark[]): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(SAVED, JSON.stringify(b));
  } catch {
    // Storage unavailable (private window): saved bookmarks last for this visit only.
  }
}

function randomBelow(n: number): number {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return (a[0] ?? 0) % n;
}

const degOf = (rad: number): number => {
  const d = radToDeg(rad) % 360;
  return d < 0 ? d + 360 : d;
};

const urlJoin = (base: string, path: string): string =>
  `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

export function EngagementViewer(props: EngagementViewerProps): JSX.Element {
  const { catalogue, modelBaseUrl, syncUrl = false } = props;
  const [v, setV] = useState<ViewState>(() => decodeView(props.initialSearch ?? "", catalogue));
  const update = useCallback((patch: Partial<ViewState>) => {
    setV((old) => ({ ...old, ...patch }));
  }, []);

  const source = catalogue.sources.find((x) => x.id === v.source) ?? catalogue.sources[0];
  const pair = catalogue.pairs.find((x) => x.id === v.pair) ?? catalogue.pairs.at(-1);
  if (source === undefined || pair === undefined) throw new Error("empty viewer catalogue");

  const s = useMemo(() => scenarioAt(source, v.index), [source, v.index]);
  const view = useMemo(() => engagementView(s), [s]);
  const dt = s.metadata.parameters.dt_s;
  const n = s.metadata.samples;
  const windowS = (n - 1) * dt;
  const zigT = s.metadata.zig_index * dt;
  const tCur = Math.min(windowS, v.t ?? Math.min(zigT + 600, windowS));
  const cursor = sampleAt(s, tCur);

  const entry: ModelEntry | null =
    v.mode === "instantaneous" ? pair.instantaneous : v.mode === "time-late" ? pair.timeLate : null;
  const key = entry === null ? "" : `${source.id}:${String(v.index)}:${pair.id}:${entry.id}`;
  const cache = useRef(new Map<string, Inference>());
  const [inference, setInference] = useState<Inference | null>(null);

  useEffect(() => {
    if (entry === null) return;
    const hit = cache.current.get(key);
    if (hit !== undefined) {
      setInference(hit);
      return;
    }
    const run = { live: true };
    setInference({ key, prediction: null, ms: 0, error: null });
    void (async () => {
      let result: Inference;
      try {
        const rt = await runtime();
        const model = await rt.load(urlJoin(modelBaseUrl, `${entry.path}/model.json`));
        const t0 = performance.now();
        const prediction = modelPrediction<Tensor>(rt.tf, model, s, entry);
        result = { key, prediction, ms: performance.now() - t0, error: null };
        cache.current.set(key, result);
      } catch (e) {
        result = {
          key,
          prediction: null,
          ms: 0,
          error: e instanceof Error ? e.message : String(e),
        };
      }
      if (run.live) setInference(result);
    })();
    return () => {
      run.live = false;
    };
  }, [key, entry, s, modelBaseUrl]);

  const model = inference?.key === key ? inference.prediction : null;
  const loading =
    entry !== null &&
    (inference?.key !== key || (inference.prediction === null && inference.error === null));
  const classical: Prediction | null = useMemo(
    () =>
      !v.classical || v.mode === "truth"
        ? null
        : v.mode === "time-late"
          ? classicalTrack(s)
          : view.classical,
    [v.classical, v.mode, s, view],
  );
  const tracker: Prediction | null = useMemo(
    () => (!v.tracker || v.mode === "truth" ? null : trackerRows(s)),
    [v.tracker, v.mode, s],
  );
  const naive = useMemo(() => naiveRows(s, pair.naive), [s, pair]);

  // URL state.
  useEffect(() => {
    if (!syncUrl) return;
    const { pathname, hash } = globalThis.location;
    globalThis.history.replaceState(null, "", `${pathname}?${encodeView(v)}${hash}`);
  }, [v, syncUrl]);

  // Play: one sample per tick to the window's end.
  const [playing, setPlaying] = useState(false);
  const tRef = useRef(tCur);
  tRef.current = tCur;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setV((old) => ({ ...old, t: Math.min(windowS, (old.t ?? tRef.current) + dt) }));
    }, 80);
    return () => {
      clearInterval(id);
    };
  }, [playing, windowS, dt]);
  useEffect(() => {
    if (playing && tCur >= windowS) setPlaying(false);
  }, [playing, tCur, windowS]);

  // Index input commits on Enter or blur.
  const [draft, setDraft] = useState(String(v.index));
  useEffect(() => {
    setDraft(String(v.index));
  }, [v.index]);
  const goTo = (i: number): void => {
    update({ index: clampIndex(source, i), t: null });
  };

  const [saved, setSaved] = useState<Bookmark[]>([]);
  useEffect(() => {
    setSaved(loadSaved());
  }, []);
  const bookmarks = [
    ...catalogue.bookmarks.map((b) => ({ b, saved: false })),
    ...saved.map((b) => ({ b, saved: true })),
  ];
  const openBookmark = (b: Bookmark): void => {
    const src = catalogue.sources.find((x) => x.id === b.source);
    if (src === undefined) return;
    setV((old) => ({
      ...old,
      source: src.id,
      index: clampIndex(src, b.index),
      mode: b.mode ?? old.mode,
      t: b.t ?? null,
      pair: catalogue.pairs.some((p) => p.id === b.pair) ? (b.pair ?? old.pair) : old.pair,
    }));
  };

  const root = useRef<HTMLDivElement | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const planRef = useRef<SVGSVGElement | null>(null);
  const fileStem = `tma-${source.id}-${String(v.index)}-${v.mode}`;

  // Plot series.
  const ser = view.series;
  const live = v.mode === "instantaneous";
  const valuesOf = (p: Prediction | null, f: (r: PredictionRow) => number): (number | null)[] => {
    const out: (number | null)[] = new Array<number | null>(n).fill(null);
    if (p === null) return out;
    for (const r of p.rows) {
      const i = Math.round(r.timestamp_s / dt);
      if (r.converged && i >= 0 && i < n && !(live && i > cursor)) out[i] = f(r);
    }
    return out;
  };
  const est = (f: (r: PredictionRow) => number, wrap?: number): Line[] => {
    if (v.mode === "truth") return [];
    const out: Line[] = [
      { label: "model", values: valuesOf(model, f), color: C.model, wrap, width: 2 },
    ];
    if (classical !== null)
      out.push({ label: "classical", values: valuesOf(classical, f), color: C.classical, wrap });
    if (tracker !== null)
      out.push({ label: "IMM", values: valuesOf(tracker, f), color: C.tracker, wrap });
    out.push({
      label: "naive",
      values: valuesOf(naive, f),
      color: C.naive,
      dash: "6 4",
      wrap,
      width: 1.2,
    });
    return out;
  };
  const markers: Marker[] = [{ t: zigT, label: "zig" }];
  const zig2 = s.metadata.zig2_index;
  if (zig2 != null) markers.push({ t: zig2 * dt, label: "zig 2" });
  // The target's course change (generator 0.4.0): where it starts, and G4's point five minutes
  // after it ends.
  const tgtTurn = s.metadata.manoeuvre_start_index;
  const tgtLeg = s.metadata.manoeuvre_index;
  if (tgtTurn != null) markers.push({ t: (tgtTurn - 1) * dt, label: "target turn" });
  if (tgtLeg != null && v.mode !== "truth" && (tgtLeg + 30) * dt <= windowS)
    markers.push({ t: (tgtLeg + 30) * dt, label: "turn+5" });
  if (v.mode !== "truth") {
    for (const [m, label] of [
      [300, "zig+5"],
      [600, "zig+10"],
    ] as const) {
      if (zigT + m <= windowS) markers.push({ t: zigT + m, label });
    }
  }
  const turnShade: [number, number][] = [view.legs.turn, view.legs.turn2]
    .filter((t): t is [number, number] => t !== undefined && t[1] > t[0])
    .map(([a, b]) => [a * dt, b * dt]);
  const common = {
    t: ser.t,
    cursorT: tCur,
    windowS,
    markers,
    shade: turnShade,
    unobservableUntil: v.mode === "truth" ? null : zigT,
    onCursor: (t: number) => {
      update({ t: Math.round(t / dt) * dt });
    },
  };
  const angleTicks = [0, 90, 180, 270, 360];
  const truthAndEst = v.mode !== "truth";
  const plots = (
    <>
      {truthAndEst && (
        <TimePlot
          {...common}
          title="Range"
          unit="km"
          lines={[
            { label: "truth", values: ser.rangeKm, color: C.target, width: 2 },
            ...est((r) => r.range_m / 1000),
          ]}
        />
      )}
      <TimePlot
        {...common}
        title="Course"
        unit="° true"
        yRange={[0, 360]}
        yTicks={angleTicks}
        lines={[
          { label: "ownship", values: ser.ownCourseDeg, color: C.own, wrap: 360 },
          { label: "target", values: ser.tgtCourseDeg, color: C.target, wrap: 360, width: 2 },
          ...est((r) => degOf(r.course_rad), 360),
        ]}
      />
      <TimePlot
        {...common}
        title="Speed"
        unit="kt"
        lines={[
          { label: "ownship", values: ser.ownSpeedKt, color: C.own },
          { label: "target", values: ser.tgtSpeedKt, color: C.target, width: 2 },
          ...est((r) => mpsToKt(r.speed_mps)),
        ]}
      />
      <TimePlot
        {...common}
        title="Bearing"
        unit="° true"
        yRange={[0, 360]}
        yTicks={angleTicks}
        lines={[
          { label: "observed", values: ser.bearingObsDeg, color: C.bearing, dots: true },
          ...(v.trueBearings
            ? [
                {
                  label: "true",
                  values: ser.bearingTrueDeg,
                  color: C.trueBearing,
                  wrap: 360,
                  dash: "4 3",
                },
              ]
            : []),
        ]}
      />
      <TimePlot
        {...common}
        title="Bearing rate"
        unit="°/min"
        lines={[{ label: "derived feature", values: ser.bearingRateDegMin, color: C.bearing }]}
      />
      {!truthAndEst && (
        <TimePlot
          {...common}
          title="Range"
          unit="km"
          lines={[{ label: "truth", values: ser.rangeKm, color: C.target }]}
        />
      )}
    </>
  );

  const estimates: Estimate[] =
    v.mode === "truth"
      ? []
      : [
          { label: "model", color: C.model, row: rowAtSample(model, s, cursor) },
          ...(classical === null
            ? []
            : [{ label: "classical", color: C.classical, row: rowAtSample(classical, s, cursor) }]),
          ...(tracker === null
            ? []
            : [{ label: "IMM", color: C.tracker, row: rowAtSample(tracker, s, cursor) }]),
          { label: "naive", color: C.naive, row: rowAtSample(naive, s, cursor) },
        ];

  const summary = useMemo(() => {
    if (v.mode === "truth") return [];
    return [
      { label: "model", color: C.model, e: model === null ? null : scenarioErrors(s, model) },
      ...(classical === null
        ? []
        : [{ label: "classical", color: C.classical, e: scenarioErrors(s, classical) }]),
      ...(tracker === null
        ? []
        : [{ label: "IMM", color: C.tracker, e: scenarioErrors(s, tracker) }]),
      { label: "naive", color: C.naive, e: scenarioErrors(s, naive) },
    ];
  }, [v.mode, model, classical, tracker, naive, s]);

  const modeLabel: Record<Mode, string> = {
    truth: "truth",
    instantaneous: "instantaneous",
    "time-late": "time-late",
  };

  const scenarioPanel = (
    <div className="tmav-panel">
      <h3>Scenario</h3>
      <Metadata s={s} source={source} generatorVersion={catalogue.generatorVersion} />
    </div>
  );

  return (
    <div className="tmav" ref={root}>
      <style>{CSS}</style>
      <div className="tmav-bar">
        <label>
          dataset
          <select
            value={source.id}
            onChange={(e) => {
              const src = catalogue.sources.find((x) => x.id === e.target.value);
              if (src !== undefined)
                update({
                  source: src.id,
                  index: clampIndex(src, src.start + (v.index - source.start)),
                  t: null,
                });
            }}
          >
            {catalogue.sources.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          index
          <input
            type="number"
            min={source.start}
            max={source.end - 1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            onBlur={() => {
              goTo(Number(draft));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") goTo(Number(draft));
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            goTo(v.index - 1);
          }}
          aria-label="previous scenario"
        >
          ◀
        </button>
        <button
          type="button"
          onClick={() => {
            goTo(v.index + 1);
          }}
          aria-label="next scenario"
        >
          ▶
        </button>
        <button
          type="button"
          onClick={() => {
            goTo(source.start + randomBelow(source.end - source.start));
          }}
        >
          random
        </button>
        <label>
          bookmark
          <select
            value=""
            onChange={(e) => {
              const b = bookmarks[Number(e.target.value)];
              if (b !== undefined) openBookmark(b.b);
            }}
          >
            <option value="">choose…</option>
            {bookmarks.map((b, j) => (
              <option key={`${String(j)}-${b.b.label}`} value={j}>
                {b.saved ? "★ " : ""}
                {b.b.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            const b: Bookmark = {
              label: `${source.label} ${String(v.index)}, ${v.mode}, t ${(tCur / 60).toFixed(1)} min`,
              source: source.id,
              index: v.index,
              mode: v.mode,
              t: tCur,
              pair: pair.id,
            };
            const next = [...saved, b];
            setSaved(next);
            storeSaved(next);
          }}
        >
          save view
        </button>
        {saved.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setSaved([]);
              storeSaved([]);
            }}
          >
            clear saved
          </button>
        )}
      </div>
      <div className="tmav-bar">
        <span role="radiogroup" aria-label="mode" style={{ display: "inline-flex", gap: 12 }}>
          {(["truth", "instantaneous", "time-late"] as const).map((m) => (
            <label key={m}>
              <input
                type="radio"
                name="tmav-mode"
                checked={v.mode === m}
                onChange={() => {
                  update({ mode: m });
                }}
              />
              {modeLabel[m]}
            </label>
          ))}
        </span>
        <label>
          models
          <select
            value={pair.id}
            onChange={(e) => {
              update({ pair: e.target.value });
            }}
          >
            {catalogue.pairs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={v.classical}
            onChange={(e) => {
              update({ classical: e.target.checked });
            }}
          />
          classical
        </label>
        <label title="Interacting-multiple-model tracker (constant velocity + coordinated turn); preview settings, not the G4 tuning">
          <input
            type="checkbox"
            checked={v.tracker}
            onChange={(e) => {
              update({ tracker: e.target.checked });
            }}
          />
          IMM
        </label>
        <label>
          <input
            type="checkbox"
            checked={v.trueBearings}
            onChange={(e) => {
              update({ trueBearings: e.target.checked });
            }}
          />
          true bearings
        </label>
        <button
          type="button"
          onClick={() => {
            // Array.from, not a spread: the site's Babel compiles [...nodeList] to [].concat(nodeList).
            const svgs =
              root.current === null
                ? []
                : Array.from(root.current.querySelectorAll<SVGSVGElement>("svg.tmav-svg"));
            setExportError(null);
            savePng(svgs, `${fileStem}.png`).catch((e: unknown) => {
              setExportError(e instanceof Error ? e.message : String(e));
            });
          }}
        >
          PNG
        </button>
        <button
          type="button"
          onClick={() => {
            const ps = [model, classical, tracker, v.mode === "truth" ? null : naive].filter(
              (p): p is Prediction => p !== null,
            );
            saveText(viewNdjson(s, ps), `${fileStem}.ndjson`);
          }}
        >
          NDJSON
        </button>
      </div>
      <div className="tmav-bar" style={{ flexWrap: "nowrap" }}>
        <button
          type="button"
          onClick={() => {
            if (!playing && tCur >= windowS) update({ t: 0 });
            setPlaying(!playing);
          }}
          aria-label={playing ? "pause" : "play"}
        >
          {playing ? "❚❚" : "►"}
        </button>
        <input
          className="tmav-slider"
          type="range"
          min={0}
          max={windowS}
          step={dt}
          value={tCur}
          aria-label="time"
          onChange={(e) => {
            update({ t: Number(e.target.value) });
          }}
        />
        <span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
          {(tCur / 60).toFixed(1)} / {(windowS / 60).toFixed(1)} min (
          {tCur >= zigT ? "zig+" : "zig−"}
          {(Math.abs(tCur - zigT) / 60).toFixed(1)})
        </span>
      </div>
      {exportError !== null && <p className="tmav-warn">PNG export failed: {exportError}</p>}
      {entry !== null && (
        <p
          className={inference?.key === key && inference.error !== null ? "tmav-warn" : "tmav-note"}
          data-testid="tmav-status"
        >
          {loading
            ? `Running ${entry.id}…`
            : inference?.error != null
              ? `Could not run ${entry.id}: ${inference.error}`
              : `${entry.id}: ${String(Math.round(inference?.ms ?? 0))} ms on the CPU backend.`}
        </p>
      )}
      <div className="tmav-grid">
        <div>
          <PlanView
            key={`${source.id}:${String(v.index)}`}
            s={s}
            view={view}
            cursor={cursor}
            mode={v.mode}
            model={model}
            classical={classical}
            tracker={tracker}
            trueBearings={v.trueBearings}
            svgRef={planRef}
          />
          <p className="tmav-note">
            Drag to pan, wheel to zoom, double-click to reset. Velocity vectors show 5 min of
            motion.
          </p>
          {v.mode === "truth" && scenarioPanel}
          {v.mode !== "truth" && (
            <div className="tmav-panel">
              <h3>At the cursor</h3>
              <Readout s={s} cursor={cursor} estimates={estimates} />
            </div>
          )}
          {v.mode !== "truth" && (
            <div className="tmav-panel">
              <h3>This scenario</h3>
              <Summary rows={summary} />
            </div>
          )}
        </div>
        <div>
          {plots}
          {v.mode !== "truth" && scenarioPanel}
          <div className="tmav-panel">
            <h3>Models</h3>
            <ModelInfo pair={pair} source={source} />
          </div>
        </div>
      </div>
    </div>
  );
}
