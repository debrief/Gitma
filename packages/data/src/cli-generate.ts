import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { DEFAULT_RANGES, HELDOUT_RANGES, noiseFree, parseSeed } from "@tma/sim";
import { ParameterRanges, parseRecord } from "@tma/types";
import { isMain, runCli, UsageError } from "./cli.js";
import { type Format, generateDataset } from "./generate.js";
import { type GitProvenance, generatorProvenance, readGitProvenance } from "./provenance.js";

/** sha256 of a ranges file, so the header identifies it without depending on its path. */
const fileDigest = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

function loadRanges(path: string): ParameterRanges {
  return parseRecord(ParameterRanges, JSON.parse(readFileSync(path, "utf8")), path, "ranges");
}

export interface GenerateDeps {
  /** Commit and tree state of the checkout (tests inject their own). */
  provenance?: () => GitProvenance;
}

export function main(argv: string[], deps: GenerateDeps = {}): unknown {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      seed: { type: "string" },
      count: { type: "string" },
      out: { type: "string" },
      ranges: { type: "string" },
      "heldout-ranges": { type: "string" },
      "noise-free": { type: "boolean", default: false },
      format: { type: "string", default: "f32pack" },
      "allow-dirty": { type: "boolean", default: false },
    },
  });
  if (values.seed === undefined || values.count === undefined || values.out === undefined) {
    throw new UsageError(
      "usage: tma-generate --seed <uint64> --count <n> --out <dir> [--ranges f] [--heldout-ranges f] [--noise-free] [--allow-dirty] [--format f32pack|ndjson|both]",
    );
  }
  const count = Number(values.count);
  if (!Number.isInteger(count) || count < 1)
    throw new UsageError("--count must be a positive integer");
  const format = values.format as Format;
  if (!["ndjson", "f32pack", "both"].includes(format)) throw new UsageError("bad --format");
  let ranges = values.ranges === undefined ? DEFAULT_RANGES : loadRanges(values.ranges);
  let heldout =
    values["heldout-ranges"] === undefined ? HELDOUT_RANGES : loadRanges(values["heldout-ranges"]);
  // The default held-out ranges have no target manoeuvre: a manoeuvre dataset without its own
  // held-out ranges would silently get a held-out split of a different problem (G0 panel, phase 3).
  if (
    (ranges.target_manoeuvre_fraction != null ||
      ranges.target_course_change_count_weights != null) &&
    values["heldout-ranges"] === undefined
  )
    throw new UsageError("--ranges with a target manoeuvre needs --heldout-ranges");
  if (values["noise-free"]) {
    ranges = noiseFree(ranges);
    heldout = noiseFree(heldout);
  }
  // Read before any output is written (the output folder may sit inside the checkout).
  const provenance = generatorProvenance(
    (deps.provenance ?? readGitProvenance)(),
    values["allow-dirty"],
  );
  const t0 = performance.now();
  const splits = generateDataset({
    seed: parseSeed(values.seed),
    count,
    outDir: values.out,
    ranges,
    heldoutRanges: heldout,
    format,
    provenance,
    // Only generation-relevant arguments, so output bytes do not depend on paths or format; ranges
    // files are named by content digest (G0 panel 2026-10-13: the manifest must identify them).
    createdBy: [
      `tma-generate --seed ${values.seed} --count ${String(count)}`,
      values["noise-free"] ? " --noise-free" : "",
      values.ranges === undefined ? "" : ` --ranges sha256:${fileDigest(values.ranges)}`,
      values["heldout-ranges"] === undefined
        ? ""
        : ` --heldout-ranges sha256:${fileDigest(values["heldout-ranges"])}`,
    ].join(""),
  });
  const seconds = (performance.now() - t0) / 1000;
  const total = splits.reduce((n, s) => n + s.scenarios, 0);
  return { out: values.out, splits, seconds, scenarios_per_s: Math.round(total / seconds) };
}

if (isMain(import.meta.url)) process.exitCode = runCli(main, process.argv.slice(2));
