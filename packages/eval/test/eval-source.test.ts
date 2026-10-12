// evaluate-g1.yml's source-folder resolution (.github/scripts/resolve-eval-source.sh).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../../../.github/scripts/resolve-eval-source.sh", import.meta.url),
);

function workspace(folders: string[], evalSource?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "tma-eval-source-"));
  for (const f of folders) mkdirSync(join(dir, "experiments", f, "models"), { recursive: true });
  if (evalSource !== undefined) {
    mkdirSync(join(dir, ".github"));
    writeFileSync(join(dir, ".github", "eval-source"), evalSource);
  }
  return dir;
}

function resolve(dir: string, input = ""): { status: number | null; env: string; out: string } {
  const envFile = join(dir, "env");
  writeFileSync(envFile, "");
  const r = spawnSync("bash", [SCRIPT], {
    cwd: dir,
    encoding: "utf8",
    env: { PATH: process.env.PATH, GITHUB_ENV: envFile, INPUT_SOURCE: input },
  });
  return { status: r.status, env: readFileSync(envFile, "utf8"), out: r.stdout + r.stderr };
}

const ok = (id: string) => `SRC=experiments/${id}/models\nEXP=experiments/${id}-r2\n`;

describe("evaluate-g1 source folder", () => {
  it("uses the only candidate when nothing is named", () => {
    expect(resolve(workspace(["20261011-g1", "20261011-g0"]))).toMatchObject({
      status: 0,
      env: ok("20261011-g1"),
    });
  });

  it("fails, listing the candidates, when several exist and none is named", () => {
    const r = resolve(workspace(["20261011-g1", "20261011-g1-r2"]));
    expect(r.status).toBe(1);
    expect(r.env).toBe("");
    expect(r.out).toMatch(/2 experiments\/\*-g1\*\/models folders and no explicit source/);
    expect(r.out).toMatch(/^ {2}experiments\/20261011-g1$/m);
    expect(r.out).toMatch(/^ {2}experiments\/20261011-g1-r2$/m);
  });

  it("fails when there is no candidate", () => {
    expect(resolve(workspace([])).status).toBe(1);
  });

  it("takes .github/eval-source (first non-comment line), and the input over it", () => {
    const dir = workspace(
      ["20261011-g1", "20261011-g1-r2"],
      "# source\n\nexperiments/20261011-g1\n",
    );
    expect(resolve(dir)).toMatchObject({ status: 0, env: ok("20261011-g1") });
    expect(resolve(dir, "experiments/20261011-g1-r2/models/")).toMatchObject({
      status: 0,
      env: ok("20261011-g1-r2"),
    });
  });

  it("rejects a folder outside experiments/ or without models/", () => {
    const dir = workspace(["20261011-g1"]);
    for (const bad of ["../etc", "experiments/..", "experiments/a/b", "experiments/missing"]) {
      const r = resolve(dir, bad);
      expect(r.status, bad).toBe(1);
      expect(r.env, bad).toBe("");
    }
    expect(resolve(workspace(["20261011-g1"], "# nothing\n")).status).toBe(1);
  });
});
