// Prediction files (contracts/file-formats.md): line 1 PredictionHeader, then one Prediction per line.
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { canonicalJson, openAtomic, writeAll } from "@tma/data";
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

/** Provenance a prediction file may carry beyond its truth digest (schema 0.17.0). */
export type PredictionProvenance = Pick<PredictionHeader, "model_weights_sha256" | "inputs">;

export function predictionHeader(
  estimator: string,
  mode: PredictionMode,
  truthPath: string,
  provenance: PredictionProvenance = {},
): PredictionHeader {
  return {
    record: "header",
    schema_version: SCHEMA_VERSION,
    estimator,
    mode,
    dataset_digest: fileDigest(truthPath),
    ...(provenance.model_weights_sha256 == null
      ? {}
      : { model_weights_sha256: provenance.model_weights_sha256 }),
    ...(provenance.inputs == null ? {} : { inputs: provenance.inputs }),
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

/**
 * A prediction file written as it is made: the header line, then one line per prediction, renamed
 * into place on commit. Byte-identical to `predictionLines(...).join("\n") + "\n"`, without
 * holding the file in memory (a 40,000-scenario per-timestep file exceeds V8's string limit).
 */
export function openPredictionStream(
  path: string,
  header: PredictionHeader,
): { write(p: Prediction): void; commit(): void; abort(): void; readonly count: number } {
  const f = openAtomic(path);
  let pending: string[] = [`${canonicalJson(header)}\n`];
  let bytes = 0;
  let count = 0;
  const flush = (): void => {
    writeAll(f.fd, Buffer.from(pending.join(""), "utf8"));
    pending = [];
    bytes = 0;
  };
  return {
    write(p) {
      const line = `${canonicalJson(p)}\n`;
      pending.push(line);
      bytes += line.length;
      count++;
      if (bytes >= 1 << 24) flush();
    },
    commit() {
      flush();
      f.commit();
    },
    abort() {
      f.abort();
    },
    get count() {
      return count;
    },
  };
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
