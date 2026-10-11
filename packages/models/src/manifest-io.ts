import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ModelManifest, parseRecord } from "@tma/types";

/** The manifest of a trained model directory; refuses an unfinished run. */
export function readModelManifest(dir: string): ModelManifest {
  const path = join(dir, "manifest.json");
  const m = parseRecord(ModelManifest, JSON.parse(readFileSync(path, "utf8")), path, "manifest");
  if (!m.complete) throw new Error(`${dir}: training has not finished`);
  return m;
}
