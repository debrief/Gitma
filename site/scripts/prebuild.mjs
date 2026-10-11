// Generated site inputs (not committed): gate status from experiments/*/verdict.json and the
// data dictionary from schema/tma.yaml (SRD §9: generated, never hand-edited).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

const n = gates();
const r = results();
dataDictionary();
console.log(`prebuild: ${n} gate verdict(s), ${r} result set(s); data dictionary generated`);
