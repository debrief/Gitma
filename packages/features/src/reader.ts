// Random-access reader for .features.bin (layout in features-file.ts). Reads one scenario's tensors
// at a time, so training can stream a file far larger than memory.
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import {
  DatasetHeader,
  FeatureLayout,
  type FeatureSet,
  NormalisationConstants,
  parseRecord,
  RecordError,
} from "@tma/types";
import { FEATURE_MAGIC, type FeatureSource, READABLE_FEATURE_VERSIONS } from "./features-file.js";
import { inputChannels, inputWidth, NT, type Window } from "./layout.js";

export interface FeatureFile {
  path: string;
  /** Format version (1: iteration 1, no source; 2: source header and digest embedded). */
  version: number;
  count: number;
  /** Scenario index (as in the dataset) of each stored window. */
  indices: Int32Array;
  layout: FeatureLayout;
  /** `layout.feature_set`, absent meaning raw. */
  featureSet: FeatureSet;
  /** Input channels per row: 10 (raw) or 13 (derived); `read(k).inputs` is [rows × this]. */
  inputChannels: number;
  /** Rows per window (`layout.rows`): 240 up to generator 0.4.0, 360 for 0.5.0. */
  rows: number;
  norm: NormalisationConstants;
  /** Source dataset header and SHA-256 (version 2); undefined for version 1. */
  source: FeatureSource | undefined;
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
    if (!READABLE_FEATURE_VERSIONS.includes(version)) {
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
    let source: FeatureSource | undefined;
    if (version >= 2) {
      const h = readExact(fd, pos, 4, path, "source header").readUInt32LE(0);
      pos += 4;
      const header = parseRecord(
        DatasetHeader,
        json(readExact(fd, pos, h, path, "source header"), path, "source header"),
        path,
        "source header",
      );
      pos += h;
      const d = readExact(fd, pos, 4, path, "source digest").readUInt32LE(0);
      pos += 4;
      const digest = readExact(fd, pos, d, path, "source digest").toString("utf8").trimEnd();
      pos += d;
      if (digest === "") throw new RecordError(path, "source digest", "empty source digest");
      source = { header, digest };
    }
    const count = readExact(fd, pos, 4, path, "count").readUInt32LE(0);
    pos += 4;
    const idxBuf = readExact(fd, pos, 4 * count, path, "indices");
    const indices = new Int32Array(count);
    for (let i = 0; i < count; i++) indices[i] = idxBuf.readInt32LE(4 * i);
    pos += 4 * count;
    const featureSet = layout.feature_set ?? "raw";
    const ni = inputWidth(featureSet);
    const channels = inputChannels(featureSet);
    const rows = layout.rows;
    if (
      !Number.isInteger(rows) ||
      rows < 1 ||
      layout.input_channels.length !== ni ||
      layout.input_channels.some((c, i) => c !== channels[i]) ||
      layout.target_channels.length !== NT
    ) {
      throw new RecordError(path, "layout", "feature layout does not match this build");
    }
    const inBytes = rows * ni * 4;
    const tgBytes = rows * NT * 4;
    const lmBytes = rows * 4;
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
      version,
      count,
      indices,
      layout,
      featureSet,
      inputChannels: ni,
      rows,
      norm,
      source,
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
