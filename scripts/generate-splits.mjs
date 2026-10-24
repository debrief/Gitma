// Generate selected splits of a dataset only (G2 re-score tooling, SRD §7): the fresh test split of
// a large count without its train, validation and held-out splits (a 100,000-scenario test split
// is the test split of a 1,000,000-scenario dataset, whose train split alone would be ~7 GB).
//
//   generate-splits.mjs --seed <uint64> --count <n> --ranges <f> --heldout-ranges <f> --out <dir>
//                       --splits test[,heldout,…] [--allow-dirty]
//
// Every scenario is seeded by (seed, index) alone, so a split written here is byte-identical,
// header included, to the same split of `tma-generate` with the same arguments: the scenarios come
// from the G0-verified generator (`generateScenario`, `planSplits`, `openPackWriter` from the built
// @tma/sim and @tma/data), and the header is built as `generateDataset` and `tma-generate` build it.
// It lives here, not in packages/data/src, so the generator source stays as G0 verified it (the G0
// guard and lineage compare packages/sim/src and packages/data/src with the G0 commit);
// packages/models/test/generate-splits.test.ts holds it to tma-generate's bytes.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const dist = (pkg) => new URL(`../packages/${pkg}/dist/index.js`, import.meta.url).href;
const { generatorProvenance, openPackWriter, planSplits, readGitProvenance } = await import(
  dist("data")
);
const { GENERATOR_VERSION, generateScenario, parseSeed } = await import(dist("sim"));
const { ParameterRanges, parseRecord, SCHEMA_VERSION } = await import(dist("types"));

export const SPLIT_NAMES = ["train", "validation", "test", "heldout"];

class UsageError extends Error {}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const loadRanges = (path) =>
  parseRecord(ParameterRanges, JSON.parse(readFileSync(path, "utf8")), path, "ranges");

/** `tma-generate`'s created_by for these arguments (cli-generate.ts: generation-relevant only). */
export const createdBy = (seed, count, ranges, heldoutRanges) =>
  `tma-generate --seed ${seed} --count ${String(count)} --ranges sha256:${sha256(ranges)} --heldout-ranges sha256:${sha256(heldoutRanges)}`;

/**
 * Writes `<out>/<split>.f32pack` for each of `splits`; returns one summary per split. `seed` is
 * the decimal string as given to tma-generate; `provenance` as `generatorProvenance` returns it.
 */
export function generateSplits({ seed, count, ranges, heldoutRanges, out, splits, provenance }) {
  const r = loadRanges(ranges);
  const h = loadRanges(heldoutRanges);
  const plans = planSplits(count, r, h);
  for (const s of splits) {
    if (!SPLIT_NAMES.includes(s)) throw new UsageError(`unknown split "${s}"`);
  }
  if (new Set(splits).size !== splits.length) throw new UsageError("--splits names a split twice");
  const seed64 = parseSeed(seed);
  const by = createdBy(seed, count, ranges, heldoutRanges);
  mkdirSync(out, { recursive: true });
  return plans
    .filter((p) => splits.includes(p.split))
    .map((plan) => {
      let redraws = 0;
      for (let i = plan.start; i < plan.end; i++)
        redraws += generateScenario(seed64, i, plan.ranges).redraws;
      // generateDataset's header (packages/data/src/generate.ts), field for field.
      const header = {
        record: "header",
        schema_version: SCHEMA_VERSION,
        generator_version: GENERATOR_VERSION,
        dataset_seed: seed64.toString(),
        split: plan.split,
        scenario_count: plan.end - plan.start,
        index_start: plan.start,
        index_end: plan.end,
        parameter_ranges: plan.ranges,
        redraw_count: redraws,
        created_by: by,
        generator_git_commit: provenance.generator_git_commit,
        generator_git_dirty: provenance.generator_git_dirty,
      };
      const file = join(out, `${plan.split}.f32pack`);
      const w = openPackWriter(file, header);
      try {
        for (let i = plan.start; i < plan.end; i++)
          w.write(generateScenario(seed64, i, plan.ranges).scenario);
        w.close();
      } catch (e) {
        w.abort();
        throw e;
      }
      return { split: plan.split, scenarios: header.scenario_count, redraws, files: [file] };
    });
}

function main(argv) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      seed: { type: "string" },
      count: { type: "string" },
      ranges: { type: "string" },
      "heldout-ranges": { type: "string" },
      out: { type: "string" },
      splits: { type: "string" },
      "allow-dirty": { type: "boolean", default: false },
    },
  });
  const { seed, ranges, out, splits } = values;
  const heldoutRanges = values["heldout-ranges"];
  if (!seed || !values.count || !ranges || !heldoutRanges || !out || !splits) {
    throw new UsageError(
      "usage: generate-splits.mjs --seed <uint64> --count <n> --ranges <f> --heldout-ranges <f> --out <dir> --splits test[,heldout,…] [--allow-dirty]",
    );
  }
  const count = Number(values.count);
  if (!Number.isInteger(count) || count < 1)
    throw new UsageError("--count must be a positive integer");
  // As tma-generate: provenance read before any output is written; a dirty tree is refused.
  const provenance = generatorProvenance(readGitProvenance(), values["allow-dirty"]);
  const summary = generateSplits({
    seed,
    count,
    ranges,
    heldoutRanges,
    out,
    splits: splits.split(",").map((s) => s.trim()),
    provenance,
  });
  process.stdout.write(`${JSON.stringify({ out, splits: summary })}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = e instanceof UsageError || e?.code?.startsWith?.("ERR_PARSE_ARGS") ? 1 : 2;
  }
}
