import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { GENERATOR_VERSION, generateScenario } from "@tma/sim";
import { type DatasetHeader, type ParameterRanges, SCHEMA_VERSION, type Split } from "@tma/types";
import { openPackWriter } from "./f32pack.js";
import { type DatasetWriter, openNdjsonWriter } from "./ndjson.js";

export type Format = "ndjson" | "f32pack" | "both";

export interface SplitPlan {
  split: Split;
  start: number;
  end: number;
  ranges: ParameterRanges;
}

/** Train/validation/test 80/10/10 by index; held-out gets count/10 indices after the rest (FR-008). */
export function planSplits(
  count: number,
  ranges: ParameterRanges,
  heldout: ParameterRanges,
): SplitPlan[] {
  const a = Math.floor(0.8 * count);
  const b = Math.floor(0.9 * count);
  return [
    { split: "train", start: 0, end: a, ranges },
    { split: "validation", start: a, end: b, ranges },
    { split: "test", start: b, end: count, ranges },
    { split: "heldout", start: count, end: count + Math.floor(count / 10), ranges: heldout },
  ];
}

export interface GenerateOptions {
  seed: bigint;
  count: number;
  outDir: string;
  ranges: ParameterRanges;
  heldoutRanges: ParameterRanges;
  format: Format;
  createdBy: string;
  /** Header provenance (research R2), from `generatorProvenance` in the CLI. */
  provenance: { generator_git_commit: string; generator_git_dirty: boolean };
}

export interface SplitSummary {
  split: Split;
  scenarios: number;
  redraws: number;
  files: string[];
}

/** Count redraws first so the header (written before any scenario) is exact. */
function countRedraws(seed: bigint, plan: SplitPlan): number {
  let redraws = 0;
  for (let i = plan.start; i < plan.end; i++) {
    redraws += generateScenario(seed, i, plan.ranges).redraws;
  }
  return redraws;
}

export function generateDataset(opts: GenerateOptions): SplitSummary[] {
  mkdirSync(opts.outDir, { recursive: true });
  return planSplits(opts.count, opts.ranges, opts.heldoutRanges).map((plan) => {
    const header: DatasetHeader = {
      record: "header",
      schema_version: SCHEMA_VERSION,
      generator_version: GENERATOR_VERSION,
      dataset_seed: opts.seed.toString(),
      split: plan.split,
      scenario_count: plan.end - plan.start,
      index_start: plan.start,
      index_end: plan.end,
      parameter_ranges: plan.ranges,
      redraw_count: countRedraws(opts.seed, plan),
      created_by: opts.createdBy,
      generator_git_commit: opts.provenance.generator_git_commit,
      generator_git_dirty: opts.provenance.generator_git_dirty,
    };
    const files: string[] = [];
    const writers: DatasetWriter[] = [];
    if (opts.format !== "f32pack") {
      files.push(join(opts.outDir, `${plan.split}.ndjson`));
      writers.push(openNdjsonWriter(files.at(-1) ?? "", header));
    }
    if (opts.format !== "ndjson") {
      files.push(join(opts.outDir, `${plan.split}.f32pack`));
      writers.push(openPackWriter(files.at(-1) ?? "", header));
    }
    try {
      for (let i = plan.start; i < plan.end; i++) {
        const { scenario } = generateScenario(opts.seed, i, plan.ranges);
        for (const w of writers) w.write(scenario);
      }
      for (const w of writers) w.close();
    } catch (e) {
      for (const w of writers) w.abort();
      throw e;
    }
    return {
      split: plan.split,
      scenarios: header.scenario_count,
      redraws: header.redraw_count,
      files,
    };
  });
}
