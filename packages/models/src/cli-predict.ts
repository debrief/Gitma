import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileDigest, openPredictionStream, predictionHeader } from "@tma/classical";
import { isMain, readDataset, UsageError } from "@tma/data";
import { openFeatures, outputSpec } from "@tma/features";
import { runAsyncCli } from "./cli-run.js";
import { readModelManifest } from "./manifest-io.js";
import {
  loadModel,
  predictEach,
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
    // Streamed: a 40,000-scenario split's predictions exceed V8's string limit as one file.
    const w = openPredictionStream(
      values.out,
      // The weights' digest lets a gate tie these predictions to the model it binds (schema 0.17.0).
      predictionHeader(manifest.id, "per_timestep", values.truth, {
        model_weights_sha256: fileDigest(join(values.model, "weights.bin")),
      }),
    );
    let nonConverged = 0;
    try {
      predictEach(
        model,
        features,
        ds.scenarios(),
        manifest.normalisation,
        manifest.id,
        outputSpec(manifest.config),
        256,
        (p) => {
          if (p.rows.some((r) => !r.converged)) nonConverged++;
          w.write(p);
        },
      );
      w.commit();
    } catch (e) {
      w.abort();
      throw e;
    }
    return {
      out: values.out,
      estimator: manifest.id,
      scenarios: w.count,
      non_converged: nonConverged,
    };
  } finally {
    features.close();
  }
}

if (isMain(import.meta.url)) runAsyncCli(main, process.argv.slice(2));
