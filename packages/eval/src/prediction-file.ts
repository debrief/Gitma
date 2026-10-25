// Streaming prediction files (G2 re-score tooling: 100,000 test scenarios). A prediction file is
// written line by line as predictions are made, and read back on demand: opening it indexes the
// byte range of each line by scenario index, and `get` reads and validates one line. Neither side
// holds a split's predictions in memory, so evaluation memory no longer grows with every estimator
// × scenario × row. Bytes written are identical to `predictionLines(...).join("\n") + "\n"`.
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { fileDigest, predictionHeader } from "@tma/classical";
import { canonicalJson, openAtomic, readDataset, writeAll } from "@tma/data";
import {
  parseRecord,
  Prediction,
  PredictionHeader,
  type PredictionMode,
  RecordError,
  type Scenario,
} from "@tma/types";
import type { PredictionLookup, PredictionSet } from "./evaluate.js";

/**
 * A dataset file's scenarios as a re-iterable: every iteration re-reads the file, so evaluation
 * can pass over a large split many times without holding it in memory.
 */
export function scenarioSource(path: string): Iterable<Scenario> {
  return { [Symbol.iterator]: () => readDataset(path).scenarios() };
}

/** Writes a prediction file incrementally; `commit` renames it into place (atomic). */
export interface PredictionWriter {
  write(p: Prediction): void;
  /** Number of predictions written so far. */
  readonly count: number;
  commit(): void;
  abort(): void;
}

const FLUSH_BYTES = 1 << 22;

/** Opens `path` for incremental writing: the header now, one canonical-JSON line per `write`. */
export function openPredictionWriter(
  path: string,
  estimator: string,
  mode: PredictionMode,
  truthPath: string,
): PredictionWriter {
  const header = predictionHeader(estimator, mode, truthPath);
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
    write(p) {
      const line = `${canonicalJson(p)}\n`;
      pending.push(line);
      bytes += line.length;
      count++;
      if (bytes >= FLUSH_BYTES) flush();
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

/** Writes every prediction of `ps` to `path` as it is produced (atomic: all or nothing). */
export function writePredictionStream(
  path: string,
  estimator: string,
  truthPath: string,
  ps: Iterable<Prediction>,
): number {
  const w = openPredictionWriter(path, estimator, "per_timestep", truthPath);
  try {
    for (const p of ps) w.write(p);
    w.commit();
  } catch (e) {
    w.abort();
    throw e;
  }
  return w.count;
}

/** Canonical JSON puts `scenario_index` last: read it from the line's tail without parsing. */
const TAIL = /"scenario_index":(\d+)\}\s*$/;

interface Line {
  /** 1-based line number (for errors). */
  lineNo: number;
  offset: number;
  length: number;
}

/**
 * A file-backed `PredictionLookup`: the line of each scenario index, read and validated on each
 * `get`. A Map's semantics: a repeated index keeps its first position and its last line.
 * Refuses to read a file that changed (size or modification time) since it was indexed.
 */
class FileLookup implements PredictionLookup {
  constructor(
    private readonly path: string,
    private readonly lines: Map<number, Line>,
    private readonly size_: number,
    private readonly mtimeMs: number,
  ) {}

  get size(): number {
    return this.lines.size;
  }

  get(index: number): Prediction | undefined {
    const line = this.lines.get(index);
    if (line === undefined) return undefined;
    const fd = openSync(this.path, "r");
    let text: string;
    try {
      const st = fstatSync(fd);
      if (st.size !== this.size_ || st.mtimeMs !== this.mtimeMs) {
        throw new Error(`${this.path}: changed since it was opened for evaluation`);
      }
      const buf = Buffer.allocUnsafe(line.length);
      let off = 0;
      while (off < line.length) {
        const n = readSync(fd, buf, off, line.length - off, line.offset + off);
        if (n === 0) throw new RecordError(this.path, line.lineNo, "truncated line");
        off += n;
      }
      text = buf.toString("utf8");
    } finally {
      closeSync(fd);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new RecordError(this.path, line.lineNo, "malformed JSON");
    }
    const p = parseRecord(Prediction, raw, this.path, line.lineNo);
    if (p.scenario_index !== index) {
      throw new RecordError(this.path, line.lineNo, `scenario_index is not ${String(index)}`);
    }
    return p;
  }

  *[Symbol.iterator](): Iterator<[number, Prediction]> {
    for (const idx of this.lines.keys()) {
      const p = this.get(idx);
      if (p !== undefined) yield [idx, p];
    }
  }
}

/** Calls `onLine(lineNo, offset, bytes)` for each non-empty line of `path`, streamed. */
function scanLines(
  path: string,
  onLine: (lineNo: number, offset: number, bytes: Buffer) => void,
): { size: number; mtimeMs: number } {
  const fd = openSync(path, "r");
  try {
    const st = fstatSync(fd);
    const chunk = Buffer.alloc(1 << 22);
    let carry: Buffer = Buffer.alloc(0);
    let carryAt = 0;
    let pos = 0;
    let lineNo = 0;
    const emit = (offset: number, bytes: Buffer): void => {
      lineNo++;
      if (bytes.length > 0) onLine(lineNo, offset, bytes);
    };
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, pos);
      if (n === 0) break;
      let start = 0;
      for (;;) {
        const nl = chunk.indexOf(10, start);
        if (nl < 0 || nl >= n) break;
        const part = chunk.subarray(start, nl);
        if (carry.length > 0) {
          emit(carryAt, Buffer.concat([carry, part]));
          carry = Buffer.alloc(0);
        } else {
          emit(pos + start, part);
        }
        start = nl + 1;
      }
      if (start < n) {
        if (carry.length === 0) carryAt = pos + start;
        carry = Buffer.concat([carry, chunk.subarray(start, n)]);
      }
      pos += n;
    }
    if (carry.length > 0) emit(carryAt, carry);
    return { size: st.size, mtimeMs: st.mtimeMs };
  } finally {
    closeSync(fd);
  }
}

/**
 * Opens a prediction file for streaming evaluation, checking it was made from `truthPath`
 * (dataset digest), as `loadPredictionSet` does. Predictions are read and validated when looked
 * up, so a malformed line is reported when it is first read rather than at open.
 */
export function openPredictionSet(path: string, truthPath: string): PredictionSet {
  let header: PredictionHeader | undefined;
  const lines = new Map<number, Line>();
  const stamp = scanLines(path, (lineNo, offset, bytes) => {
    if (header === undefined) {
      let raw: unknown;
      try {
        raw = JSON.parse(bytes.toString("utf8"));
      } catch {
        throw new RecordError(path, lineNo, "malformed JSON");
      }
      header = parseRecord(PredictionHeader, raw, path, lineNo);
      return;
    }
    const tail = TAIL.exec(bytes.subarray(Math.max(0, bytes.length - 48)).toString("latin1"));
    let idx: number;
    if (tail?.[1] !== undefined) {
      idx = Number(tail[1]);
    } else {
      let raw: unknown;
      try {
        raw = JSON.parse(bytes.toString("utf8"));
      } catch {
        throw new RecordError(path, lineNo, "malformed JSON");
      }
      idx = parseRecord(Prediction, raw, path, lineNo).scenario_index;
    }
    // As `new Map(entries)`: a repeated index keeps its first position and takes the last line.
    lines.set(idx, { lineNo, offset, length: bytes.length });
  });
  if (header === undefined) throw new RecordError(path, 1, "empty file");
  if (header.dataset_digest !== fileDigest(truthPath)) {
    throw new Error(`${path}: predictions were made from a different truth file than ${truthPath}`);
  }
  const label =
    header.mode === "per_timestep" ? `${header.estimator}:per_timestep` : header.estimator;
  return {
    label,
    estimator: header.estimator,
    byIndex: new FileLookup(path, lines, stamp.size, stamp.mtimeMs),
  };
}
