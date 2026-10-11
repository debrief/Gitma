// Prediction files (contracts/file-formats.md): line 1 PredictionHeader, then one Prediction per line.
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { canonicalJson } from "@tma/data";
import {
  parseRecord,
  Prediction,
  PredictionHeader,
  type PredictionMode,
  RecordError,
  SCHEMA_VERSION,
} from "@tma/types";

/** SHA-256 of a file, streamed. */
export function fileDigest(path: string): string {
  const h = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(1 << 20);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}

export function predictionHeader(
  estimator: string,
  mode: PredictionMode,
  truthPath: string,
): PredictionHeader {
  return {
    record: "header",
    schema_version: SCHEMA_VERSION,
    estimator,
    mode,
    dataset_digest: fileDigest(truthPath),
  };
}

export function predictionLines(
  header: PredictionHeader,
  predictions: Iterable<Prediction>,
): string[] {
  const lines = [canonicalJson(header)];
  for (const p of predictions) lines.push(canonicalJson(p));
  return lines;
}

export function parsePredictions(
  path: string,
  text: string,
): { header: PredictionHeader; predictions: Prediction[] } {
  const lines = text.split("\n").filter((l) => l !== "");
  const parse = (i: number): unknown => {
    try {
      return JSON.parse(lines[i] ?? "");
    } catch {
      throw new RecordError(path, i + 1, "malformed JSON");
    }
  };
  if (lines.length === 0) throw new RecordError(path, 1, "empty file");
  const header = parseRecord(PredictionHeader, parse(0), path, 1);
  const predictions = lines
    .slice(1)
    .map((_, i) => parseRecord(Prediction, parse(i + 1), path, i + 2));
  return { header, predictions };
}
