// Git provenance of the code that produced a file (constitution II; spec 003 US1, research R2).
// Shared by dataset headers (tma-generate) and experiment and model manifests (@tma/eval).
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface GitProvenance {
  /** Commit checked out (`git rev-parse HEAD`), or "unknown" outside a git checkout. */
  commit: string;
  /** Uncommitted changes, untracked files included (ignored ones not); true outside git. */
  dirty: boolean;
  /** False when `cwd` is not inside a git checkout (or git is unavailable). */
  inGit: boolean;
}

/** This package's own directory: git runs in the checkout the code came from, not the caller's. */
export const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Read commit and tree state together, in `cwd`. Callers read it once, before writing any output,
 * so the record names the code that ran and is not marked dirty by its own untracked output.
 */
export function readGitProvenance(cwd: string = PACKAGE_DIR): GitProvenance {
  let commit: string;
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return { commit: "unknown", dirty: true, inGit: false };
  }
  let dirty: boolean;
  try {
    dirty =
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() !== "";
  } catch {
    dirty = true;
  }
  return { commit, dirty, inGit: true };
}

/** A refusal on provenance grounds (exit 2, like any refused input). */
export class ProvenanceError extends Error {}

/**
 * Provenance to record in a dataset header. Refuses a dirty tree, or a run outside git, unless
 * `allowDirty`; then the header says `generator_git_dirty: true` (commit "unknown" outside git).
 */
export function generatorProvenance(
  p: GitProvenance,
  allowDirty: boolean,
): { generator_git_commit: string; generator_git_dirty: boolean } {
  if (!allowDirty && !p.inGit) {
    throw new ProvenanceError(
      "not in a git checkout: dataset provenance cannot be recorded; pass --allow-dirty to generate anyway (recorded as generator_git_dirty: true)",
    );
  }
  if (!allowDirty && p.dirty) {
    throw new ProvenanceError(
      "working tree has uncommitted changes: commit first, or pass --allow-dirty (recorded as generator_git_dirty: true)",
    );
  }
  return { generator_git_commit: p.commit, generator_git_dirty: p.dirty || !p.inGit };
}
