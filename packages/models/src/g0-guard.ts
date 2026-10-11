// Constitution V: no training before G0 passes.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GateVerdict, parseRecord } from "@tma/types";

export function g0Passed(experimentsDir: string): string | null {
  if (!existsSync(experimentsDir)) return null;
  for (const id of readdirSync(experimentsDir).sort().reverse()) {
    const path = join(experimentsDir, id, "verdict.json");
    if (!existsSync(path)) continue;
    const v = parseRecord(GateVerdict, JSON.parse(readFileSync(path, "utf8")), path, "verdict");
    if (v.gate === "G0" && v.result === "pass") return id;
  }
  return null;
}
