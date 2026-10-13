import { DEFAULT_RANGES, GENERATOR_VERSION } from "@tma/sim";
import { type DatasetHeader, SCHEMA_VERSION } from "@tma/types";
import type { FeatureSource } from "../src/features-file.js";

/** A fixed source dataset for features written from in-memory scenarios (format v2). */
export function testSource(
  over: Partial<DatasetHeader> = {},
  digest = "d".repeat(64),
): FeatureSource {
  return {
    header: {
      record: "header",
      schema_version: SCHEMA_VERSION,
      generator_version: GENERATOR_VERSION,
      dataset_seed: "1",
      split: "train",
      scenario_count: 2,
      index_start: 0,
      index_end: 2,
      parameter_ranges: DEFAULT_RANGES,
      redraw_count: 0,
      created_by: "test",
      generator_git_commit: "0".repeat(40),
      generator_git_dirty: false,
      ...over,
    },
    digest,
  };
}
