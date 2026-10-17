// tfjs, loaded once and lazily (spec 006 FR-007): core, the CPU backend and layers only. The CPU
// backend is chosen because it gives the same numbers on every machine (WebGL does not).
import type { Tensor } from "@tensorflow/tfjs-core";
import type { LayersModel } from "@tensorflow/tfjs-layers";
import type { TfLike } from "../core/estimates.js";

export interface Runtime {
  tf: TfLike<Tensor>;
  load(url: string): Promise<LayersModel>;
}

let ready: Promise<Runtime> | null = null;
const models = new Map<string, Promise<LayersModel>>();

export function runtime(): Promise<Runtime> {
  ready ??= (async () => {
    const tf = await import("@tensorflow/tfjs-core");
    await import("@tensorflow/tfjs-backend-cpu");
    const layers = await import("@tensorflow/tfjs-layers");
    await tf.setBackend("cpu");
    await tf.ready();
    return {
      tf,
      load(url: string): Promise<LayersModel> {
        let m = models.get(url);
        if (m === undefined) {
          m = layers.loadLayersModel(url);
          models.set(url, m);
          m.catch(() => models.delete(url));
        }
        return m;
      },
    };
  })();
  return ready;
}
