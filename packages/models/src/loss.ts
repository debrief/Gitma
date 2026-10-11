// Masked weighted loss (research R5). y_true is [B, 240, 5]: four targets plus a per-row weight.
import * as tf from "@tensorflow/tfjs-node";
import type { TrainingConfig } from "@tma/types";
import { NO } from "./architectures.js";

export const NY = NO + 1;

function termWeights(config: TrainingConfig): tf.Tensor1D {
  return tf.tensor1d([
    config.loss_weight_range,
    config.loss_weight_course,
    config.loss_weight_course,
    config.loss_weight_speed,
  ]);
}

/** Weighted squared-error sum and weight sum (so means can be pooled across batches). */
export function lossParts(
  w: tf.Tensor1D,
  yTrue: tf.Tensor,
  yPred: tf.Tensor,
): { num: tf.Scalar; den: tf.Scalar } {
  const target = yTrue.slice([0, 0, 0], [-1, -1, NO]);
  const weight = yTrue.slice([0, 0, NO], [-1, -1, 1]).squeeze([2]);
  const perRow = yPred.sub(target).square().mul(w).sum(2);
  return { num: perRow.mul(weight).sum(), den: weight.sum() };
}

export function makeLoss(
  config: TrainingConfig,
): (yTrue: tf.Tensor, yPred: tf.Tensor) => tf.Scalar {
  const w = termWeights(config);
  return (yTrue, yPred) =>
    tf.tidy(() => {
      const { num, den } = lossParts(w, yTrue, yPred);
      return num.div(tf.maximum(den, 1));
    });
}

export { termWeights };
