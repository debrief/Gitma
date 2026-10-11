// experiments/<id>/ writer (contracts/file-formats.md).
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "@tma/data";
import { GENERATOR_VERSION } from "@tma/sim";
import {
  type DatasetHeader,
  type ExperimentManifest,
  type GateVerdict,
  SCHEMA_VERSION,
} from "@tma/types";
import { CURVE_COLUMNS, METRIC_COLUMNS, toCsv } from "./csv.js";
import type { Evaluation } from "./evaluate.js";

function write(dir: string, name: string, text: string): void {
  const path = join(dir, name);
  const tmp = `${path}.tmp-${String(process.pid)}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** Pretty canonical JSON (sorted keys, 2-space indent) for committed, human-read files. */
export const prettyJson = (v: unknown): string =>
  `${JSON.stringify(JSON.parse(canonicalJson(v)), null, 2)}\n`;

export function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export function makeManifest(
  id: string,
  datasets: { path: string; header: DatasetHeader }[],
  estimators: { name: string; settings: unknown }[],
  commandLines: string[],
): ExperimentManifest {
  return {
    id,
    created: new Date().toISOString(),
    git_commit: gitCommit(),
    schema_version: SCHEMA_VERSION,
    generator_version: GENERATOR_VERSION,
    datasets,
    estimators: estimators.map((e) => ({ name: e.name, settings_json: canonicalJson(e.settings) })),
    command_lines: commandLines,
  };
}

export function writeEvaluation(dir: string, ev: Evaluation): void {
  mkdirSync(dir, { recursive: true });
  write(dir, "metrics.json", prettyJson(ev.metrics));
  write(dir, "metrics.csv", toCsv(METRIC_COLUMNS, ev.metrics));
  if (ev.curves.length > 0) write(dir, "curves.csv", toCsv(CURVE_COLUMNS, ev.curves));
}

export function writeManifest(dir: string, m: ExperimentManifest): void {
  mkdirSync(dir, { recursive: true });
  write(dir, "manifest.json", prettyJson(m));
  const seeds = m.datasets
    .map((d) => {
      const h = d.header;
      return `${h.split}\tseed=${h.dataset_seed}\tindex=[${String(h.index_start)}, ${String(h.index_end)})\t${d.path}`;
    })
    .join("\n");
  write(dir, "seeds.txt", `${seeds}\n`);
}

export function writeVerdict(dir: string, v: GateVerdict): void {
  mkdirSync(dir, { recursive: true });
  write(dir, "verdict.json", prettyJson(v));
}
