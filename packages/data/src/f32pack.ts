// Training format (contracts/file-formats.md). All little-endian.
// [0] magic "TMAPACK\0" | [8] u32 format version | [12] u32 header length H | [16] header JSON
// | u32 N | u64 × (N+1) block offsets | blocks.
// Block: u32 M | metadata JSON (M bytes, space-padded to 4) | u32 S
//        | f32 ownship[S×5] | f32 target[S×5] | f32 observations[S×3]
import { closeSync, fstatSync, openSync } from "node:fs";
import {
  DatasetHeader,
  type Observation,
  parseRecord,
  type PlatformState,
  RecordError,
  type Scenario,
  ScenarioMetadata,
} from "@tma/types";
import { canonicalJson } from "./canonical.js";
import { openAtomic, readAt, writeAll } from "./io.js";
import type { Dataset, DatasetWriter } from "./ndjson.js";
import { checkVersions } from "./versions.js";

const MAGIC = Buffer.from("TMAPACK\0", "latin1");
export const PACK_FORMAT_VERSION = 1;
const STATE_FIELDS = 5;
const OBS_FIELDS = 3;

function paddedJson(value: unknown): Buffer {
  const json = Buffer.from(canonicalJson(value), "utf8");
  const pad = (4 - (json.length % 4)) % 4;
  return Buffer.concat([json, Buffer.alloc(pad, 0x20)]);
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

function encodeBlock(s: Scenario): Buffer {
  const meta = paddedJson(s.metadata);
  const n = s.metadata.samples;
  const floats = new Float32Array(n * (2 * STATE_FIELDS + OBS_FIELDS));
  let k = 0;
  for (const track of [s.ownship.states, s.target.states]) {
    for (const st of track) {
      floats[k++] = st.timestamp_s;
      floats[k++] = st.x_m;
      floats[k++] = st.y_m;
      floats[k++] = st.course_rad;
      floats[k++] = st.speed_mps;
    }
  }
  for (const o of s.observations) {
    floats[k++] = o.timestamp_s;
    floats[k++] = o.bearing_rad;
    floats[k++] = o.valid ? 1 : 0;
  }
  if (k !== floats.length) throw new Error(`scenario ${String(s.metadata.index)}: length mismatch`);
  const body = Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
  return Buffer.concat([u32(meta.length), meta, u32(n), body]);
}

export function openPackWriter(path: string, header: DatasetHeader): DatasetWriter {
  const f = openAtomic(path);
  const headerJson = paddedJson(header);
  const prefix = Buffer.concat([
    MAGIC,
    u32(PACK_FORMAT_VERSION),
    u32(headerJson.length),
    headerJson,
    u32(header.scenario_count),
  ]);
  writeAll(f.fd, prefix);
  const n = header.scenario_count;
  const tablePos = prefix.length;
  const offsets = new BigUint64Array(n + 1);
  let pos = tablePos + 8 * (n + 1);
  writeAll(f.fd, new Uint8Array(8 * (n + 1)));
  let i = 0;
  return {
    write(s) {
      if (i >= n) throw new Error(`${path}: more scenarios than header declares`);
      const block = encodeBlock(s);
      offsets[i++] = BigInt(pos);
      writeAll(f.fd, block);
      pos += block.length;
    },
    close() {
      if (i !== n) {
        f.abort();
        throw new Error(`${path}: wrote ${String(i)} of ${String(n)}`);
      }
      offsets[n] = BigInt(pos);
      // BigUint64Array is platform-endian; write explicitly little-endian.
      const le = Buffer.alloc(8 * (n + 1));
      offsets.forEach((o, j) => le.writeBigUInt64LE(o, 8 * j));
      writeAll(f.fd, le, tablePos);
      f.commit();
    },
    abort() {
      f.abort();
    },
  };
}

function decodeBlock(path: string, index: number, buf: Buffer): Scenario {
  const where = `scenario ${String(index)}`;
  if (buf.length < 8) throw new RecordError(path, where, "truncated block");
  const m = buf.readUInt32LE(0);
  if (4 + m + 4 > buf.length) throw new RecordError(path, where, "truncated block");
  let metaRaw: unknown;
  try {
    metaRaw = JSON.parse(buf.toString("utf8", 4, 4 + m));
  } catch {
    throw new RecordError(path, where, "corrupted metadata JSON");
  }
  const metadata = parseRecord(ScenarioMetadata, metaRaw, path, where);
  const n = buf.readUInt32LE(4 + m);
  const start = 8 + m;
  const floatCount = n * (2 * STATE_FIELDS + OBS_FIELDS);
  if (n !== metadata.samples || start + 4 * floatCount !== buf.length) {
    throw new RecordError(path, where, "block length does not match sample count");
  }
  const f = (j: number): number => buf.readFloatLE(start + 4 * j);
  const track = (base: number): PlatformState[] =>
    Array.from({ length: n }, (_, r) => {
      const o = base + r * STATE_FIELDS;
      return {
        timestamp_s: f(o),
        x_m: f(o + 1),
        y_m: f(o + 2),
        course_rad: f(o + 3),
        speed_mps: f(o + 4),
      };
    });
  const obsBase = 2 * n * STATE_FIELDS;
  const observations: Observation[] = Array.from({ length: n }, (_, r) => {
    const o = obsBase + r * OBS_FIELDS;
    return { timestamp_s: f(o), bearing_rad: f(o + 1), valid: f(o + 2) !== 0 };
  });
  return {
    record: "scenario",
    metadata,
    ownship: { id: "ownship", states: track(0) },
    target: { id: "target", states: track(n * STATE_FIELDS) },
    observations,
  };
}

export function readPack(path: string): Dataset {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const fixed = readAt(fd, 0, 16);
    if (fixed.length < 16 || !fixed.subarray(0, 8).equals(MAGIC)) {
      throw new RecordError(path, "header", "not a .f32pack file (bad magic)");
    }
    const version = fixed.readUInt32LE(8);
    if (version !== PACK_FORMAT_VERSION) {
      throw new RecordError(path, "header", `unsupported pack format version ${String(version)}`);
    }
    const h = fixed.readUInt32LE(12);
    const headerBuf = readAt(fd, 16, h + 4);
    if (headerBuf.length < h + 4) throw new RecordError(path, "header", "truncated header");
    let raw: unknown;
    try {
      raw = JSON.parse(headerBuf.toString("utf8", 0, h));
    } catch {
      throw new RecordError(path, "header", "corrupted header JSON");
    }
    const header = parseRecord(DatasetHeader, raw, path, "header");
    checkVersions(path, header);
    const n = headerBuf.readUInt32LE(h);
    if (n !== header.scenario_count) {
      throw new RecordError(path, "header", "scenario count does not match header");
    }
    const tablePos = 16 + h + 4;
    const table = readAt(fd, tablePos, 8 * (n + 1));
    if (table.length < 8 * (n + 1)) throw new RecordError(path, "header", "truncated offsets");
    const offsets = Array.from({ length: n + 1 }, (_, j) => Number(table.readBigUInt64LE(8 * j)));
    if (offsets[n] !== size) {
      throw new RecordError(
        path,
        "end",
        `file is ${String(size)} bytes, expected ${String(offsets[n])}`,
      );
    }
    return {
      header,
      *scenarios() {
        const rfd = openSync(path, "r");
        try {
          for (let i = 0; i < n; i++) {
            const a = offsets[i] ?? 0;
            const b = offsets[i + 1] ?? 0;
            yield decodeBlock(path, i, readAt(rfd, a, b - a));
          }
        } finally {
          closeSync(rfd);
        }
      },
    };
  } finally {
    closeSync(fd);
  }
}
