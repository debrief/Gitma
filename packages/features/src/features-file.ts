// Features binary (.features.bin), little-endian:
// "TMAFEAT\0" | u32 version | u32 L | FeatureLayout JSON (L, space-padded to 4)
// | u32 K | NormalisationConstants JSON (K, padded)
// | (version 2 only) u32 H | source DatasetHeader JSON (H, padded)
// |                  u32 D | source dataset SHA-256, hex (D, padded)
// | u32 N | i32 scenario_index[N]
// | f32 inputs[N×240×C] | f32 targets[N×240×6] | f32 loss_mask[N×240]
// Version 2 (spec 003 US1) carries the dataset's provenance into training (lineage); version 1
// (iteration 1) is still read. The layout JSON may name a `feature_set` (absent = raw); C is its
// input width (10 raw, 13 derived; spec 003 US3).
import { endianness } from "node:os";
import { canonicalJson, openAtomic, writeAll } from "@tma/data";
import type {
  DatasetHeader,
  FeatureLayout,
  FeatureSet,
  NormalisationConstants,
  Scenario,
} from "@tma/types";
import {
  buildWindow,
  inputChannels,
  NI,
  NT,
  rateScale,
  ROWS,
  rowsFor,
  TARGET_CHANNELS,
} from "./layout.js";

export const FEATURE_MAGIC = "TMAFEAT\0";
export const FEATURE_FORMAT_VERSION = 2;
/** Versions the reader accepts. */
export const READABLE_FEATURE_VERSIONS: readonly number[] = [1, 2];

/** The layout recorded in a features file of feature set `fs`. */
export const layoutFor = (fs: FeatureSet, rows: number = ROWS): FeatureLayout => ({
  feature_set: fs,
  rows,
  input_channels: [...inputChannels(fs)],
  target_channels: [...TARGET_CHANNELS],
});

export const LAYOUT: FeatureLayout = layoutFor("raw");

/** The dataset a features file was built from: its header and the SHA-256 of its file. */
export interface FeatureSource {
  header: DatasetHeader;
  digest: string;
}

function pad(b: Buffer): Buffer {
  return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, 0x20)]);
}

const padded = (value: unknown): Buffer => pad(Buffer.from(canonicalJson(value), "utf8"));

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

const LITTLE_ENDIAN = endianness() === "LE";

/** Little-endian float32 bytes: a copy of the array's memory on LE hosts (same bytes, faster). */
const f32le = (a: Float32Array): Buffer => {
  if (LITTLE_ENDIAN) return Buffer.from(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));
  const b = Buffer.alloc(a.length * 4);
  a.forEach((v, i) => b.writeFloatLE(v, 4 * i));
  return b;
};

/**
 * Write tensors for all scenarios (format version 2, with the source dataset's header and digest);
 * returns the scenario count. Three passes keep memory flat. Refuses, before writing, a norm file
 * that lacks a constant the feature set needs.
 */
export function writeFeatures(
  path: string,
  scenarios: () => Iterable<Scenario>,
  norm: NormalisationConstants,
  source: FeatureSource,
  featureSet: FeatureSet = "raw",
): number {
  if (featureSet === "derived") rateScale(norm);
  const indices: number[] = [];
  for (const s of scenarios()) indices.push(s.metadata.index);
  const idx = Buffer.alloc(4 * indices.length);
  indices.forEach((v, i) => idx.writeInt32LE(v, 4 * i));
  const f = openAtomic(path);
  try {
    // Rows from the source's ranges: 240 up to generator 0.4.0, 360 for 0.5.0's 60-min windows.
    const rows = rowsFor(source.header.parameter_ranges);
    const layout = padded(layoutFor(featureSet, rows));
    const nc = padded(norm);
    const sh = padded(source.header);
    const sd = pad(Buffer.from(source.digest, "utf8"));
    writeAll(
      f.fd,
      Buffer.concat([
        Buffer.from(FEATURE_MAGIC, "latin1"),
        u32(FEATURE_FORMAT_VERSION),
        u32(layout.length),
        layout,
        u32(nc.length),
        nc,
        u32(sh.length),
        sh,
        u32(sd.length),
        sd,
        u32(indices.length),
        idx,
      ]),
    );
    for (const part of ["inputs", "targets", "lossMask"] as const) {
      // Targets and loss mask do not depend on the feature set: skip the derived channels' work.
      const fs = part === "inputs" ? featureSet : "raw";
      for (const s of scenarios()) writeAll(f.fd, f32le(buildWindow(s, norm, fs, rows)[part]));
    }
    f.commit();
  } catch (e) {
    f.abort();
    throw e;
  }
  return indices.length;
}

/** Tensor shapes of the raw set; the derived set's inputs are [ROWS, NI_DERIVED]. */
export const TENSOR_SHAPES = { inputs: [ROWS, NI], targets: [ROWS, NT], lossMask: [ROWS] } as const;
