// Generated site inputs (not committed): gate status from experiments/*/verdict.json, the
// data dictionary from schema/tma.yaml (SRD §9: generated, never hand-edited), and the viewer's
// catalogue and model copies from the gate experiments (spec 006 FR-007).
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const site = fileURLToPath(new URL("..", import.meta.url));
const root = join(site, "..");

function gates() {
  const dir = join(root, "experiments");
  const runs = existsSync(dir) ? readdirSync(dir).sort().reverse() : [];
  const out = [];
  for (const id of runs) {
    const path = join(dir, id, "verdict.json");
    if (!existsSync(path)) continue;
    const v = JSON.parse(readFileSync(path, "utf8"));
    out.push({ id, gate: v.gate, result: v.result, decided_by: v.decided_by, checks: v.checks });
  }
  mkdirSync(join(site, "src", "generated"), { recursive: true });
  writeFileSync(join(site, "src", "generated", "gates.json"), `${JSON.stringify(out, null, 2)}\n`);
  return out.length;
}

/** Rows of a CSV written by @tma/eval's toCsv (no quoted cells in these files). */
function readCsv(path) {
  const [head, ...lines] = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l !== "");
  const cols = head.split(",");
  return lines.map((l) => {
    const cells = l.split(",");
    return Object.fromEntries(
      cols.map((c, i) => [
        c,
        c === "estimator" ? cells[i] : cells[i] === "" ? null : Number(cells[i]),
      ]),
    );
  });
}

/** Experiments with error curves (per-timestep runs, G1 onward) for the results review pages. */
function results() {
  const dir = join(root, "experiments");
  const runs = existsSync(dir) ? readdirSync(dir).sort().reverse() : [];
  const out = [];
  for (const id of runs) {
    const base = join(dir, id);
    if (!existsSync(join(base, "curves.csv")) || !existsSync(join(base, "verdict.json"))) continue;
    const read = (f) => JSON.parse(readFileSync(join(base, f), "utf8"));
    const heldout = join(base, "heldout", "metrics.json");
    const bootstrap = join(base, "bootstrap.json");
    out.push({
      id,
      verdict: read("verdict.json"),
      metrics: read("metrics.json"),
      curves: readCsv(join(base, "curves.csv")),
      heldout: existsSync(heldout) ? JSON.parse(readFileSync(heldout, "utf8")) : [],
      bootstrap: existsSync(bootstrap) ? JSON.parse(readFileSync(bootstrap, "utf8")) : null,
      review: existsSync(join(base, "review.md")),
    });
  }
  writeFileSync(join(site, "src", "generated", "results.json"), `${JSON.stringify(out)}\n`);
  return out.length;
}

function run(args) {
  return execFileSync("uv", ["run", "--frozen", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function dataDictionary() {
  let md = run(["gen-markdown-datadict", "--anchor-style", "mkdocs", "schema/tma.yaml"]);
  // Drop the generator's H1 and empty Mermaid blocks (Mermaid rejects empty diagrams).
  md = md.replace(/^# .*\n/m, "");
  md = md.replace(/```mermaid\n(classDiagram|erDiagram)\n(\s*\w+ \{\s*\}\s*)*```\n?/g, "");
  md = md.replace(/^## Class Diagram\s*\n(?=## )/m, "");
  // LinkML attributes become class-qualified slots (anchor "class__slot"), but the generator links
  // them by bare name inside each class section; qualify those links.
  md = md
    .split(/(?=^### )/m)
    .map((section) => {
      const cls = /^### (\w+)/.exec(section)?.[1];
      if (cls === undefined) return section;
      return section.replace(/\]\(#([a-z0-9_]+)\)/g, (link, slot) =>
        md.includes(`id="${cls.toLowerCase()}__${slot}"`)
          ? `](#${cls.toLowerCase()}__${slot})`
          : link,
      );
    })
    .join("");
  const units = run(["python", "packages/types/scripts/units.py", "schema/tma.yaml"]);
  const front = [
    "---",
    "title: Data dictionary",
    "description: Every LinkML class and slot, generated from schema/tma.yaml.",
    "---",
    "",
    ":::info Generated",
    "Generated from `schema/tma.yaml` at build time by `gen-markdown-datadict`. Do not edit; change the schema.",
    ":::",
    "",
    "## Units",
    "",
    units,
  ].join("\n");
  writeFileSync(join(site, "docs", "data-dictionary.md"), `${front}\n${md}`);
}

/**
 * Each gate's carried pair (Annex A decision D3), oldest first: the viewer defaults to the last.
 * The scenario sources are those experiments' test and held-out datasets, from their headers.
 */
const VIEWER_PAIRS = [
  { id: "i1", label: "Iteration 1", experiment: "20261012-g1-r2" },
  { id: "i2", label: "Iteration 2", experiment: "20261014-i2-g2" },
  { id: "i2b", label: "Iteration 2b", experiment: "20261015-i2c-g2" },
  { id: "i2c", label: "Iteration 2c", experiment: "20261016-i2d-g2" },
  // Stopped at validation (spec 007 FR-006): no test split was scored, so no verdict.json.
  {
    id: "i3",
    label: "Iteration 3",
    experiment: "20261021-i3a-val",
    gate: "G2 validation: stopped before test",
  },
  // The seed-206 re-score (SRD §7) decided G2; seed 205's inconclusive test split is not shown.
  { id: "i4", label: "Iteration 4", experiment: "20261025-i4-g2-rescore" },
];
const VIEWER_MODELS = { instantaneous: "lstm-instantaneous", timeLate: "bilstm-time-late" };
/**
 * Datasets of plans not yet scored, shown before training so the owner can check the engagements
 * (Annex A B.2.1). Only the validation split: a test split stays unseen until its gate.
 */
const VIEWER_PLANS = [
  {
    plan: "configs/iter3/a/plan.json",
    label: "Iteration 3",
    trained: "the iteration-3 models were trained on its train split and never saw this one",
  },
];

/** The panel's decision where it overrides the machine result (e.g. G1 passed under rule 1). */
function decision(verdict) {
  const m = /\b(G\d) (PASS|FAIL)\b/.exec(verdict.decided_by ?? "");
  return m === null ? `${verdict.gate} ${verdict.result}` : `${m[1]} ${m[2].toLowerCase()}`;
}

function viewer() {
  const read = (path) => JSON.parse(readFileSync(path, "utf8"));
  const out = join(site, "static", "viewer", "models");
  rmSync(out, { recursive: true, force: true });
  const sources = [];
  const pairs = [];
  let bytes = 0;
  for (const p of [...VIEWER_PAIRS].reverse()) {
    const base = join(root, "experiments", p.experiment);
    const exp = read(join(base, "manifest.json"));
    const verdict = p.gate === undefined ? read(join(base, "verdict.json")) : null;
    const train = exp.datasets.find((d) => d.header.split === "train")?.header;
    for (const split of ["test", "heldout"]) {
      const h = exp.datasets.find((d) => d.header.split === split)?.header;
      if (h === undefined) continue;
      const id = `s${h.dataset_seed}-${split}`;
      if (sources.some((x) => x.id === id)) continue;
      const fresh = h.dataset_seed !== train?.dataset_seed;
      const r0 = h.parameter_ranges.target_range0_m;
      const t0 = train?.parameter_ranges.target_range0_m;
      const km = (r) => `${String(r.min / 1000)}–${String(r.max / 1000)} km`;
      const notes = [];
      if (fresh)
        notes.push(`A fresh test split: seed ${h.dataset_seed}'s test split, never trained on.`);
      if (t0 !== undefined && (r0.min !== t0.min || r0.max !== t0.max))
        notes.push(`Start ranges ${km(r0)}, outside the training ranges (${km(t0)}).`);
      sources.push({
        id,
        label:
          split === "test"
            ? `Seed ${h.dataset_seed} test (${p.label} ${verdict?.gate ?? "G2"})`
            : `Seed ${h.dataset_seed} held-out (${km(r0)})`,
        seed: h.dataset_seed,
        start: h.index_start,
        end: h.index_end,
        ranges: h.parameter_ranges,
        ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
      });
    }
    const naive = JSON.parse(exp.estimators.find((e) => e.name === "naive").settings_json).means;
    const entry = (variant, id) => {
      const dir = join(base, "models", id);
      const m = read(join(dir, "manifest.json"));
      const c = m.config;
      const kind = c.model_kind === "time_late" ? "BiLSTM" : "LSTM";
      const layers = c.layers ?? 1;
      const dest = join(out, p.experiment, id);
      mkdirSync(dest, { recursive: true });
      for (const f of ["model.json", "weights.bin"]) {
        copyFileSync(join(dir, f), join(dest, f));
        bytes += readFileSync(join(dir, f)).length;
      }
      return {
        id,
        variant,
        path: `${p.experiment}/${id}`,
        featureSet: c.feature_set ?? "raw",
        normalisation: m.normalisation,
        ...(c.output_parameterisation === "velocity"
          ? {
              output: { parameterisation: "velocity", velocityScaleMps: c.velocity_scale_mps },
            }
          : {}),
        parameterCount: m.parameter_count,
        architecture: `${kind} ${layers > 1 ? `${String(layers)} × ` : ""}${String(c.units)} units`,
        trainedOnSeed: m.source_dataset_header?.dataset_seed ?? train?.dataset_seed ?? null,
        bestEpoch: m.best_epoch,
      };
    };
    pairs.unshift({
      id: p.id,
      label: p.label,
      experiment: `experiments/${p.experiment}`,
      gate: verdict === null ? (p.gate ?? "") : decision(verdict),
      instantaneous: entry("instantaneous", VIEWER_MODELS.instantaneous),
      timeLate: entry("time_late", VIEWER_MODELS.timeLate),
      naive,
    });
  }
  for (const v of [...VIEWER_PLANS].reverse()) {
    const d = read(join(root, v.plan)).dataset;
    sources.unshift({
      id: `s${d.seed}-validation`,
      label: `Seed ${d.seed} validation (${v.label}${v.trained === undefined ? ", before training" : ""})`,
      seed: d.seed,
      start: Math.floor(0.8 * d.count),
      end: Math.floor(0.9 * d.count),
      ranges: read(join(root, d.ranges)),
      note: `The ${v.label.toLowerCase()} dataset (${v.plan}); ${v.trained ?? "no model has been trained on it yet"}.`,
    });
  }
  const sim = readFileSync(join(root, "packages", "sim", "src", "scenario.ts"), "utf8");
  const generatorVersion = /GENERATOR_VERSION = "([^"]+)"/.exec(sim)?.[1] ?? "unknown";
  const bookmarks = read(join(site, "src", "data", "viewer-bookmarks.json"));
  for (const b of bookmarks) {
    if (!sources.some((x) => x.id === b.source))
      throw new Error(`viewer bookmark: no source ${b.source}`);
  }
  writeFileSync(
    join(site, "src", "generated", "viewer.json"),
    `${JSON.stringify({ generatorVersion, sources, pairs, bookmarks })}\n`,
  );
  return { sources: sources.length, pairs: pairs.length, mb: bytes / 1e6 };
}

const n = gates();
const r = results();
const v = viewer();
dataDictionary();
console.log(
  `prebuild: ${n} gate verdict(s), ${r} result set(s); viewer: ${v.sources} sources, ` +
    `${v.pairs} model pairs, ${v.mb.toFixed(1)} MB of weights; data dictionary generated`,
);
