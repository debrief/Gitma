import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { cpus } from "node:os";
import * as tf from "@tensorflow/tfjs-node";

export function sha256File(path: string): string {
  const h = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(1 << 22);
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

export function environment(): {
  tfjs_node_version: string;
  node_version: string;
  cpu_model: string;
} {
  return {
    tfjs_node_version: tf.version["tfjs-node"],
    node_version: process.version,
    cpu_model: cpus()[0]?.model ?? "unknown",
  };
}
