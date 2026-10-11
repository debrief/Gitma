import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RecordError } from "@tma/types";
import { describe, expect, it } from "vitest";
import { convertDataset, readDataset, sameDataset } from "../src/index.js";
import { makeDataset, tempDir } from "./helpers.js";

const drain = (path: string): number => {
  return [...readDataset(path).scenarios()].length;
};

describe("round-trip NDJSON ↔ f32pack", () => {
  const dir = makeDataset(3n, 40);

  it("both formats hold identical scenarios", () => {
    for (const split of ["train", "validation", "test", "heldout"]) {
      const r = sameDataset(join(dir, `${split}.ndjson`), join(dir, `${split}.f32pack`));
      expect(r.same, r.detail).toBe(true);
    }
  });

  it("conversion in either direction reproduces the original bytes", () => {
    const out = tempDir();
    convertDataset(join(dir, "train.f32pack"), join(out, "t.ndjson"));
    convertDataset(join(dir, "train.ndjson"), join(out, "t.f32pack"));
    expect(readFileSync(join(out, "t.ndjson")).equals(readFileSync(join(dir, "train.ndjson")))).toBe(
      true,
    );
    expect(
      readFileSync(join(out, "t.f32pack")).equals(readFileSync(join(dir, "train.f32pack"))),
    ).toBe(true);
  });
});

describe("rejection", () => {
  const dir = makeDataset(4n, 20);
  const out = tempDir();

  it("rejects a different schema version", () => {
    const lines = readFileSync(join(dir, "test.ndjson"), "utf8").split("\n");
    lines[0] = (lines[0] ?? "").replace(/"schema_version":"[^"]*"/, '"schema_version":"9.9.0"');
    const p = join(out, "v.ndjson");
    writeFileSync(p, lines.join("\n"));
    expect(() => readDataset(p)).toThrow(/schema version 9\.9\.0/);
  });

  it("rejects a different generator version", () => {
    const text = readFileSync(join(dir, "test.ndjson"), "utf8").replace(
      /"generator_version":"[^"]*"/,
      '"generator_version":"0.0.1"',
    );
    const p = join(out, "g.ndjson");
    writeFileSync(p, text);
    expect(() => readDataset(p)).toThrow(/generator version 0\.0\.1/);
  });

  it("truncated NDJSON fails naming file and line", () => {
    const text = readFileSync(join(dir, "train.ndjson"), "utf8");
    const p = join(out, "t.ndjson");
    writeFileSync(p, text.slice(0, Math.floor(text.length * 0.6)));
    expect(() => drain(p)).toThrow(RecordError);
    expect(() => drain(p)).toThrow(/t\.ndjson:\d+: malformed JSON/);
  });

  it("truncated f32pack fails before reading scenarios", () => {
    const buf = readFileSync(join(dir, "train.f32pack"));
    const p = join(out, "t.f32pack");
    writeFileSync(p, buf.subarray(0, buf.length - 100));
    expect(() => readDataset(p)).toThrow(/t\.f32pack:end: file is/);
  });

  it("corrupted f32pack metadata fails naming the scenario", () => {
    const buf = Buffer.from(readFileSync(join(dir, "train.f32pack")));
    const ds = readDataset(join(dir, "train.f32pack"));
    // Corrupt a byte inside the first block's metadata JSON (after its u32 length).
    const firstBlock = buf.indexOf(Buffer.from('{"index"'), 16 + 8);
    expect(firstBlock).toBeGreaterThan(0);
    buf[firstBlock + 1] = 0x7b;
    const p = join(out, "c.f32pack");
    writeFileSync(p, buf);
    expect(ds.header.scenario_count).toBeGreaterThan(0);
    expect(() => drain(p)).toThrow(/c\.f32pack:scenario 0: /);
  });

  it("rejects a file that is not a pack", () => {
    const p = join(out, "x.f32pack");
    writeFileSync(p, "hello world, not a pack");
    expect(() => readDataset(p)).toThrow(/bad magic/);
  });

  it("rejects a header/count mismatch in NDJSON", () => {
    const lines = readFileSync(join(dir, "train.ndjson"), "utf8").trimEnd().split("\n");
    const p = join(out, "m.ndjson");
    writeFileSync(p, `${lines.slice(0, -1).join("\n")}\n`);
    expect(() => drain(p)).toThrow(/header declares/);
  });
});
