// Constitution V: no training before G0 passes. The latest G0 verdict by manifest `created` time
// decides (a newer failure is not outvoted by an older pass; folder names do not matter); it must
// come from a clean tree, and the generator source must be unchanged since that commit.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATOR_VERSION } from "@tma/sim";
import { ExperimentManifest, GateVerdict, parseRecord } from "@tma/types";

/** Paths whose code produced the verified data. */
export const GENERATOR_PATHS = ["packages/sim/src", "packages/data/src"];

/** Repository root of this checkout (git paths are relative to it). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** True when GENERATOR_PATHS are identical in the working tree and at `commit` (git required). */
export function generatorUnchangedSince(commit: string): boolean {
  try {
    execFileSync("git", ["diff", "--quiet", commit, "--", ...GENERATOR_PATHS], {
      stdio: "ignore",
      cwd: REPO_ROOT,
    });
    const untracked = execFileSync(
      "git",
      ["ls-files", "--others", "--exclude-standard", "--", ...GENERATOR_PATHS],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    return untracked.trim() === "";
  } catch {
    return false;
  }
}

/**
 * True when GENERATOR_PATHS are identical at commits `a` and `b` (lineage, research R2). False when
 * they differ or either commit is not in this checkout's history.
 */
export function generatorPathsEqual(a: string, b: string): boolean {
  try {
    execFileSync("git", ["diff", "--quiet", a, b, "--", ...GENERATOR_PATHS], {
      stdio: "ignore",
      cwd: REPO_ROOT,
    });
    return true;
  } catch {
    return false;
  }
}

export interface G0GuardOptions {
  generatorUnchanged?: (commit: string) => boolean;
}

/** The G0 experiment the guard accepted and the commit its verdict was produced at. */
export interface AcceptedG0 {
  id: string;
  commit: string;
}

/** Id of the accepted G0 experiment, or null (see `g0Accepted`). */
export function g0Passed(experimentsDir: string, opts: G0GuardOptions = {}): string | null {
  return g0Accepted(experimentsDir, opts)?.id ?? null;
}

export function g0Accepted(experimentsDir: string, opts: G0GuardOptions = {}): AcceptedG0 | null {
  const unchanged = opts.generatorUnchanged ?? generatorUnchangedSince;
  if (!existsSync(experimentsDir)) return null;
  const g0s: { id: string; verdict: GateVerdict; manifest: ExperimentManifest | null }[] = [];
  for (const id of readdirSync(experimentsDir)) {
    const path = join(experimentsDir, id, "verdict.json");
    if (!existsSync(path)) continue;
    const verdict = parseRecord(
      GateVerdict,
      JSON.parse(readFileSync(path, "utf8")),
      path,
      "verdict",
    );
    if (verdict.gate !== "G0") continue;
    const mPath = join(experimentsDir, id, "manifest.json");
    const manifest = existsSync(mPath)
      ? parseRecord(ExperimentManifest, JSON.parse(readFileSync(mPath, "utf8")), mPath, "manifest")
      : null;
    g0s.push({ id, verdict, manifest });
  }
  // A G0 verdict without a manifest cannot be dated or traced: refuse rather than guess.
  if (g0s.length === 0 || g0s.some((g) => g.manifest === null)) return null;
  const created = (g: (typeof g0s)[number]): number => Date.parse(g.manifest?.created ?? "");
  // An unparseable date would make the ordering depend on directory order: refuse.
  if (g0s.some((g) => Number.isNaN(created(g)))) return null;
  g0s.sort((a, b) => created(b) - created(a));
  const [latest, next] = g0s;
  if (latest?.manifest == null) return null;
  if (next !== undefined && created(next) === created(latest)) return null; // ambiguous
  const m = latest.manifest;
  const ok =
    latest.verdict.result === "pass" &&
    m.git_dirty === false &&
    m.generator_version === GENERATOR_VERSION &&
    unchanged(m.git_commit);
  return ok ? { id: latest.id, commit: m.git_commit } : null;
}
