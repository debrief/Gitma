import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, renameSync, rmSync, writeSync } from "node:fs";

/** A file written to a temporary path and renamed into place on commit (atomic writes). */
export interface AtomicFile {
  fd: number;
  commit(): void;
  abort(): void;
}

export function openAtomic(path: string): AtomicFile {
  const tmp = `${path}.tmp-${String(process.pid)}`;
  const fd = openSync(tmp, "w");
  return {
    fd,
    commit() {
      closeSync(fd);
      renameSync(tmp, path);
    },
    abort() {
      closeSync(fd);
      rmSync(tmp, { force: true });
    },
  };
}

/** Write all of `buf` at `position` (or the current position when null). */
export function writeAll(fd: number, buf: Uint8Array, position: number | null = null): void {
  let off = 0;
  while (off < buf.length) {
    const n = writeSync(fd, buf, off, buf.length - off, position === null ? null : position + off);
    off += n;
  }
}

/** Read exactly `length` bytes at `position`, or return the bytes available if the file ends. */
export function readAt(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  let off = 0;
  while (off < length) {
    const n = readSync(fd, buf, off, length - off, position + off);
    if (n === 0) break;
    off += n;
  }
  return off === length ? buf : buf.subarray(0, off);
}

/** Iterate the lines of a text file without loading it whole. Yields [lineNumber, text]. */
export function* readLines(path: string): Generator<[number, string]> {
  const fd = openSync(path, "r");
  try {
    const chunk = Buffer.alloc(1 << 20);
    let pending = "";
    let lineNo = 0;
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      pending += chunk.toString("utf8", 0, n);
      let nl = pending.indexOf("\n");
      while (nl >= 0) {
        lineNo++;
        yield [lineNo, pending.slice(0, nl)];
        pending = pending.slice(nl + 1);
        nl = pending.indexOf("\n");
      }
    }
    if (pending.length > 0) yield [lineNo + 1, pending];
  } finally {
    closeSync(fd);
  }
}

/** SHA-256 (hex) of a file's bytes, streamed. */
export function fileSha256(path: string): string {
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
