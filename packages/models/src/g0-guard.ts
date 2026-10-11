// Constitution V: no training before G0 passes. Only the most recent G0 verdict counts (a newer
// failure is not outvoted by an older pass), and it must have judged the current generator.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATOR_VERSION } from "@tma/sim";
import { ExperimentManifest, GateVerdict, parseRecord } from "@tma/types";

export function g0Passed(experimentsDir: string): string | null {
  if (!existsSync(experimentsDir)) return null;
  for (const id of readdirSync(experimentsDir).sort().reverse()) {
    const path = join(experimentsDir, id, "verdict.json");
    if (!existsSync(path)) continue;
    const v = parseRecord(GateVerdict, JSON.parse(readFileSync(path, "utf8")), path, "verdict");
    if (v.gate !== "G0") continue;
    if (v.result !== "pass") return null;
    const mPath = join(experimentsDir, id, "manifest.json");
    if (!existsSync(mPath)) return null;
    const m = parseRecord(
      ExperimentManifest,
      JSON.parse(readFileSync(mPath, "utf8")),
      mPath,
      "manifest",
    );
    return m.generator_version === GENERATOR_VERSION ? id : null;
  }
  return null;
}
