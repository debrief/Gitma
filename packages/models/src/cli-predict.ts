import { renameSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { predictionHeader, predictionLines } from "@tma/classical";
import { isMain, readDataset, UsageError } from "@tma/data";
import { openFeatures } from "@tma/features";
import { runAsyncCli } from "./cli-run.js";
import { readModelManifest } from "./manifest-io.js";
import {
  loadModel,
  predictScenarios,
  requireSameFeatureSet,
  requireSameNormalisation,
} from "./predict.js";

export async function main(argv: string[]): Promise<unknown> {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      model: { type: "string" },
      truth: { type: "string" },
      features: { type: "string" },
      out: { type: "string" },
      train: { type: "string" },
    },
  });
  if (!values.model || !values.truth || !values.features || !values.out) {
    throw new UsageError(
      "usage: tma-model-predict --model <dir> --truth <test.f32pack> --features <test.features.bin> --out <pred.ndjson> [--train <train.f32pack>]",
    );
  }
  const manifest = readModelManifest(values.model);
  const model = await loadModel(values.model);
  const features = openFeatures(values.features);
  try {
    requireSameFeatureSet(features, manifest.config.feature_set, manifest.id);
    // --train lets a model trained under an older schema_version run on identical re-labelled data.
    const note = requireSameNormalisation(
      features,
      manifest.normalisation,
      manifest.id,
      values.train === undefined
        ? undefined
        : {
            header: readDataset(values.train).header,
            modelSchemaVersion: manifest.schema_version,
            modelSourceHeader: manifest.source_dataset_header,
          },
    );
    if (note !== undefined) process.stderr.write(`${note}\n`);
    const ds = readDataset(values.truth);
    const preds = predictScenarios(
      model,
      features,
      ds.scenarios(),
      manifest.normalisation,
      manifest.id,
    );
    const lines = predictionLines(
      predictionHeader(manifest.id, "per_timestep", values.truth),
      preds,
    );
    const tmp = `${values.out}.tmp-${String(process.pid)}`;
    writeFileSync(tmp, `${lines.join("\n")}\n`);
    renameSync(tmp, values.out);
    const nonConverged = preds.filter((p) => p.rows.some((r) => !r.converged)).length;
    return {
      out: values.out,
      estimator: manifest.id,
      scenarios: preds.length,
      non_converged: nonConverged,
    };
  } finally {
    features.close();
  }
}

if (isMain(import.meta.url)) runAsyncCli(main, process.argv.slice(2));
