// experiments/<id>/ writer (contracts/file-formats.md).
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fileDigest } from "@tma/classical";
import { canonicalJson, UsageError } from "@tma/data";
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

/** Git runs in this package's checkout, not wherever the command was started. */
const GIT_CWD = dirname(fileURLToPath(import.meta.url));

function readGitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: GIT_CWD }).trim();
  } catch {
    return "unknown";
  }
}

/** True when the working tree has uncommitted changes (untracked files included; ignored ones not). */
function gitStatusDirty(): boolean {
  try {
    return (
      execFileSync("git", ["status", "--porcelain"], { encoding: "utf8", cwd: GIT_CWD }).trim() !==
      ""
    );
  } catch {
    return true;
  }
}

/**
 * Commit and tree state when this process started, read together before it wrote any output.
 * Experiment files are untracked until committed and would otherwise mark every run dirty, and a
 * commit read at write time could name code other than the code that ran.
 */
const COMMIT_AT_START = readGitCommit();
const DIRTY_AT_START = gitStatusDirty();

/** Commit checked out when this process started. */
export const gitCommit = (): string => COMMIT_AT_START;

/** Whether the working tree had uncommitted changes when this process started. */
export const gitDirty = (): boolean => DIRTY_AT_START;

/**
 * Experiments must trace to a commit (constitution II): refuse a dirty tree unless the caller
 * explicitly allows it, in which case the manifest records `git_dirty: true`.
 */
export function requireCleanTree(allowDirty: boolean): void {
  if (!allowDirty && gitDirty()) {
    throw new UsageError(
      "working tree has uncommitted changes: commit first, or pass --allow-dirty (recorded as git_dirty)",
    );
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
    git_dirty: gitDirty(),
    node_version: process.version,
    schema_version: SCHEMA_VERSION,
    generator_version: GENERATOR_VERSION,
    datasets: datasets.map((d) => ({ ...d, digest: fileDigest(d.path) })),
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
