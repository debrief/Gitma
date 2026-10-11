// Features binary (.features.bin), little-endian:
// "TMAFEAT\0" | u32 version | u32 L | FeatureLayout JSON (L, space-padded to 4)
// | u32 K | NormalisationConstants JSON (K, padded) | u32 N | i32 scenario_index[N]
// | f32 inputs[N×240×10] | f32 targets[N×240×6] | f32 loss_mask[N×240]
import { canonicalJson, openAtomic, writeAll } from "@tma/data";
import type { FeatureLayout, NormalisationConstants, Scenario } from "@tma/types";
import { buildWindow, INPUT_CHANNELS, NI, NT, ROWS, TARGET_CHANNELS } from "./layout.js";

export const FEATURE_MAGIC = "TMAFEAT\0";
export const FEATURE_FORMAT_VERSION = 1;

export const LAYOUT: FeatureLayout = {
  rows: ROWS,
  input_channels: [...INPUT_CHANNELS],
  target_channels: [...TARGET_CHANNELS],
};

function padded(value: unknown): Buffer {
  const b = Buffer.from(canonicalJson(value), "utf8");
  return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, 0x20)]);
}

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

const f32le = (a: Float32Array): Buffer => {
  const b = Buffer.alloc(a.length * 4);
  a.forEach((v, i) => b.writeFloatLE(v, 4 * i));
  return b;
};

/** Write tensors for all scenarios; returns the scenario count. Three passes keep memory flat. */
export function writeFeatures(
  path: string,
  scenarios: () => Iterable<Scenario>,
  norm: NormalisationConstants,
): number {
  const indices: number[] = [];
  for (const s of scenarios()) indices.push(s.metadata.index);
  const idx = Buffer.alloc(4 * indices.length);
  indices.forEach((v, i) => idx.writeInt32LE(v, 4 * i));
  const f = openAtomic(path);
  try {
    const layout = padded(LAYOUT);
    const nc = padded(norm);
    writeAll(
      f.fd,
      Buffer.concat([
        Buffer.from(FEATURE_MAGIC, "latin1"),
        u32(FEATURE_FORMAT_VERSION),
        u32(layout.length),
        layout,
        u32(nc.length),
        nc,
        u32(indices.length),
        idx,
      ]),
    );
    for (const part of ["inputs", "targets", "lossMask"] as const) {
      for (const s of scenarios()) writeAll(f.fd, f32le(buildWindow(s, norm)[part]));
    }
    f.commit();
  } catch (e) {
    f.abort();
    throw e;
  }
  return indices.length;
}

export const TENSOR_SHAPES = { inputs: [ROWS, NI], targets: [ROWS, NT], lossMask: [ROWS] } as const;
