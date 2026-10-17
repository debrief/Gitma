// FR-007: the viewer's inference (tfjs-core on the CPU backend, as the browser runs it) agrees
// with the pipeline's (tfjs-node, `tma-model-predict`'s backend) to float32 tolerance, on the
// committed 2c and iteration-1 carried models.
import { readFileSync } from "node:fs";
import * as tfc from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-cpu";
import { buildWindow, inputWidth, outputsToPrediction, ROWS } from "@tma/features";
import { loadModel } from "@tma/models";
import type { FeatureSet, NormalisationConstants, Prediction } from "@tma/types";
import { afterAll, describe, expect, it } from "vitest";
import { modelPrediction, scenarioAt } from "../src/index.js";
import { I1_TEST, I2_TEST, repoPath } from "./helpers.js";

interface Entry {
  id: string;
  featureSet: FeatureSet;
  normalisation: NormalisationConstants;
}
const entry = (dir: string): Entry => {
  const m = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8")) as {
    id: string;
    config: { feature_set?: FeatureSet };
    normalisation: NormalisationConstants;
  };
  return { id: m.id, featureSet: m.config.feature_set ?? "raw", normalisation: m.normalisation };
};

type Loaded = Awaited<ReturnType<typeof loadModel>>;

/**
 * The pipeline's path: the "tensorflow" backend `@tma/models` registers (tfjs-node, as
 * `tma-model-predict` runs), over the same window, decoded from row 0.
 */
function nodePrediction(model: Loaded, s: ReturnType<typeof scenarioAt>, e: Entry): Prediction {
  const w = buildWindow(s, e.normalisation, e.featureSet);
  const y = tfc.tidy(() => {
    const p = model.predict(tfc.tensor3d(w.inputs, [1, ROWS, inputWidth(e.featureSet)]));
    return (Array.isArray(p) ? p[0] : p)?.dataSync() as Float32Array;
  });
  return outputsToPrediction(s, y, e.normalisation, e.id, 0);
}

describe("agreement: browser (CPU) inference vs tfjs-node (FR-007)", () => {
  afterAll(async () => {
    await tfc.setBackend("tensorflow");
  });
  for (const [dir, source] of [
    ["experiments/20261016-i2d-val/models/lstm-instantaneous", I2_TEST],
    ["experiments/20261016-i2d-val/models/bilstm-time-late", I2_TEST],
    ["experiments/20261012-g1-r2/models/lstm-instantaneous", I1_TEST],
  ] as const) {
    it(
      dir,
      async () => {
        const path = repoPath(dir);
        const e = entry(path);
        const scenarios = [90000, 93210].map((i) => scenarioAt(source, i));
        await tfc.setBackend("tensorflow");
        expect(tfc.getBackend()).toBe("tensorflow");
        const nodeModel = await loadModel(path);
        const ref = scenarios.map((s) => nodePrediction(nodeModel, s, e));
        nodeModel.dispose();
        await tfc.setBackend("cpu");
        expect(tfc.getBackend()).toBe("cpu");
        const cpuModel = await loadModel(path);
        const got = scenarios.map((s) => modelPrediction<tfc.Tensor>(tfc, cpuModel, s, e));
        cpuModel.dispose();
        let worst = 0;
        got.forEach((p, k) => {
          const r = ref[k];
          expect(p.rows).toHaveLength(r?.rows.length ?? -1);
          p.rows.forEach((row, j) => {
            const o = r?.rows[j];
            if (o === undefined) throw new Error("row missing");
            expect(row.converged).toBe(o.converged);
            const rel = Math.abs(row.range_m - o.range_m) / Math.max(1, o.range_m);
            const dc = Math.abs(
              Math.atan2(
                Math.sin(row.course_rad - o.course_rad),
                Math.cos(row.course_rad - o.course_rad),
              ),
            );
            const ds = Math.abs(row.speed_mps - o.speed_mps);
            worst = Math.max(worst, rel, dc, ds);
          });
        });
        // float32 accumulation over 240 recurrent steps on two backends.
        expect(worst).toBeLessThan(1e-3);
      },
      300_000,
    );
  }
});
