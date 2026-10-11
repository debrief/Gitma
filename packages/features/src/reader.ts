// Random-access reader for .features.bin (layout in features-file.ts). Reads one scenario's tensors
// at a time, so training can stream a file far larger than memory.
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { FeatureLayout, NormalisationConstants, parseRecord, RecordError } from "@tma/types";
import { FEATURE_FORMAT_VERSION, FEATURE_MAGIC } from "./features-file.js";
import { NI, NT, ROWS, type Window } from "./layout.js";

export interface FeatureFile {
  path: string;
  count: number;
  /** Scenario index (as in the dataset) of each stored window. */
  indices: Int32Array;
  layout: FeatureLayout;
  norm: NormalisationConstants;
  /** Window k (0-based position in the file). */
  read(k: number): Window;
  close(): void;
}

function readExact(fd: number, pos: number, len: number, path: string, what: string): Buffer {
  const buf = Buffer.alloc(len);
  let off = 0;
  while (off < len) {
    const n = readSync(fd, buf, off, len - off, pos + off);
    if (n === 0) throw new RecordError(path, what, "truncated features file");
    off += n;
  }
  return buf;
}

function json(buf: Buffer, path: string, what: string): unknown {
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    throw new RecordError(path, what, "corrupted JSON block");
  }
}

export function openFeatures(path: string): FeatureFile {
  const fd = openSync(path, "r");
  try {
    const head = readExact(fd, 0, 16, path, "header");
    if (head.toString("latin1", 0, 8) !== FEATURE_MAGIC) {
      throw new RecordError(path, "header", "not a features file (bad magic)");
    }
    const version = head.readUInt32LE(8);
    if (version !== FEATURE_FORMAT_VERSION) {
      throw new RecordError(path, "header", `unsupported features version ${String(version)}`);
    }
    const l = head.readUInt32LE(12);
    let pos = 16;
    const layout = parseRecord(
      FeatureLayout,
      json(readExact(fd, pos, l, path, "layout"), path, "layout"),
      path,
      "layout",
    );
    pos += l;
    const k = readExact(fd, pos, 4, path, "norm").readUInt32LE(0);
    pos += 4;
    const norm = parseRecord(
      NormalisationConstants,
      json(readExact(fd, pos, k, path, "norm"), path, "norm"),
      path,
      "norm",
    );
    pos += k;
    const count = readExact(fd, pos, 4, path, "count").readUInt32LE(0);
    pos += 4;
    const idxBuf = readExact(fd, pos, 4 * count, path, "indices");
    const indices = new Int32Array(count);
    for (let i = 0; i < count; i++) indices[i] = idxBuf.readInt32LE(4 * i);
    pos += 4 * count;
    if (
      layout.rows !== ROWS ||
      layout.input_channels.length !== NI ||
      layout.target_channels.length !== NT
    ) {
      throw new RecordError(path, "layout", "feature layout does not match this build");
    }
    const inBytes = ROWS * NI * 4;
    const tgBytes = ROWS * NT * 4;
    const lmBytes = ROWS * 4;
    const inputsAt = pos;
    const targetsAt = inputsAt + count * inBytes;
    const maskAt = targetsAt + count * tgBytes;
    const expected = maskAt + count * lmBytes;
    if (fstatSync(fd).size !== expected) {
      throw new RecordError(
        path,
        "end",
        `file size ${String(fstatSync(fd).size)} != expected ${String(expected)}`,
      );
    }
    const f32 = (buf: Buffer): Float32Array => {
      const out = new Float32Array(buf.length / 4);
      for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(4 * i);
      return out;
    };
    return {
      path,
      count,
      indices,
      layout,
      norm,
      read(i: number): Window {
        if (!Number.isInteger(i) || i < 0 || i >= count)
          throw new RangeError(`window ${String(i)}`);
        const w = `window ${String(i)}`;
        return {
          inputs: f32(readExact(fd, inputsAt + i * inBytes, inBytes, path, w)),
          targets: f32(readExact(fd, targetsAt + i * tgBytes, tgBytes, path, w)),
          lossMask: f32(readExact(fd, maskAt + i * lmBytes, lmBytes, path, w)),
        };
      },
      close() {
        closeSync(fd);
      },
    };
  } catch (e) {
    closeSync(fd);
    throw e;
  }
}
