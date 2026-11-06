// Detection files (spec 017, schema 0.19.0): line 1 DetectionHeader, then one Detection per
// line, in canonical JSON, written as made and read back streamed (a 40,000-scenario file is
// larger than V8's string limit).
import { closeSync, openSync, readSync } from "node:fs";
import { fileDigest } from "@tma/classical";
import { canonicalJson, openAtomic, writeAll } from "@tma/data";
import {
  Detection,
  DetectionHeader,
  type PredictionInput,
  parseRecord,
  RecordError,
  SCHEMA_VERSION,
} from "@tma/types";

export interface DetectionWriter {
  write(d: Detection): void;
  readonly count: number;
  commit(): void;
  abort(): void;
}

/** Opens `path` for writing: the header now, one line per `write`, renamed into place on commit. */
export function openDetectionWriter(
  path: string,
  detector: string,
  truthPath: string,
  inputs: PredictionInput[] = [],
): DetectionWriter {
  const header: DetectionHeader = {
    record: "header",
    schema_version: SCHEMA_VERSION,
    detector,
    dataset_digest: fileDigest(truthPath),
    ...(inputs.length === 0 ? {} : { inputs }),
  };
  const f = openAtomic(path);
  let pending: string[] = [`${canonicalJson(header)}\n`];
  let bytes = 0;
  let count = 0;
  const flush = (): void => {
    if (pending.length === 0) return;
    writeAll(f.fd, Buffer.from(pending.join(""), "utf8"));
    pending = [];
    bytes = 0;
  };
  return {
    write(d) {
      if (d.detector !== detector)
        throw new Error(`detection for ${d.detector} written to a ${detector} file`);
      const line = `${canonicalJson(d)}\n`;
      pending.push(line);
      bytes += line.length;
      count++;
      if (bytes >= 1 << 22) flush();
    },
    get count() {
      return count;
    },
    commit() {
      flush();
      f.commit();
    },
    abort() {
      f.abort();
    },
  };
}

/** A detection file's scores by scenario index, with the timestamps they are at. */
export interface DetectionSet {
  path: string;
  header: DetectionHeader;
  detector: string;
  byIndex: Map<number, { t: Float64Array; score: Float32Array }>;
}

/**
 * Reads a detection file made from `truthPath` (dataset digest checked). Every line is validated;
 * a repeated scenario index is refused.
 */
export function readDetectionSet(path: string, truthPath: string): DetectionSet {
  let header: DetectionHeader | undefined;
  const byIndex = new Map<number, { t: Float64Array; score: Float32Array }>();
  let lineNo = 0;
  const onLine = (text: string): void => {
    lineNo++;
    if (text.length === 0) return;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new RecordError(path, lineNo, "malformed JSON");
    }
    if (header === undefined) {
      header = parseRecord(DetectionHeader, raw, path, lineNo);
      return;
    }
    const d = parseRecord(Detection, raw, path, lineNo);
    if (d.detector !== header.detector)
      throw new RecordError(path, lineNo, `detector ${d.detector}, header says ${header.detector}`);
    if (byIndex.has(d.scenario_index))
      throw new RecordError(path, lineNo, `scenario ${String(d.scenario_index)} repeated`);
    byIndex.set(d.scenario_index, {
      t: Float64Array.from(d.rows, (r) => r.timestamp_s),
      score: Float32Array.from(d.rows, (r) => r.score),
    });
  };
  const fd = openSync(path, "r");
  try {
    const chunk = Buffer.alloc(1 << 22);
    let carry = "";
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      const text = carry + chunk.subarray(0, n).toString("utf8");
      const parts = text.split("\n");
      carry = parts.pop() ?? "";
      for (const p of parts) onLine(p);
    }
    if (carry.length > 0) onLine(carry);
  } finally {
    closeSync(fd);
  }
  if (header === undefined) throw new RecordError(path, 1, "empty file");
  if (header.dataset_digest !== fileDigest(truthPath))
    throw new Error(`${path}: scores were made from a different truth file than ${truthPath}`);
  return { path, header, detector: header.detector, byIndex };
}
