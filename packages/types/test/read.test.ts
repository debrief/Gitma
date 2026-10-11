import { describe, expect, it } from "vitest";
import { Observation, parseRecord, RecordError, SCHEMA_VERSION } from "../src/index.js";

describe("generated schemas", () => {
  it("exposes the schema version", () => {
    expect(SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("accepts a valid record", () => {
    const obs = parseRecord(Observation, { timestamp_s: 0, bearing_rad: 1, valid: true }, "f", 1);
    expect(obs.valid).toBe(true);
  });

  it("rejects unknown fields and names file and record", () => {
    const bad = { timestamp_s: 0, bearing_rad: 1, valid: true, extra: 1 };
    expect(() => parseRecord(Observation, bad, "obs.ndjson", 7)).toThrow(RecordError);
    expect(() => parseRecord(Observation, bad, "obs.ndjson", 7)).toThrow(/^obs\.ndjson:7: /);
  });

  it("rejects a missing required field", () => {
    expect(() => parseRecord(Observation, { timestamp_s: 0, valid: true }, "f", 2)).toThrow(
      /bearing_rad/,
    );
  });
});
