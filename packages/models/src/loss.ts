// Masked weighted loss (research R5). y_true is [B, 240, 5]: four targets plus a per-row weight.
// With the velocity parameterisation (spec 008) loss_weight_speed weights each velocity component
// and the fourth output carries no loss. With velocity_two_hypothesis (spec 011) the fourth target
// is the turn label l and the output has seven channels: hypothesis 0 (not turned) and hypothesis
// 1 (turned), each (log range, vx, vy), then a turn logit. Each hypothesis's squared error counts
// only on rows where it is true; the logit adds loss_weight_manoeuvre × binary cross-entropy.
import * as tf from "@tensorflow/tfjs-node";
import { outputSpec } from "@tma/features";
import type { TrainingConfig } from "@tma/types";
import { NO } from "./architectures.js";

export const NY = NO + 1;

function termWeights(config: TrainingConfig): tf.Tensor1D {
  const p = outputSpec(config).parameterisation;
  if (p === "velocity" || p === "velocity_two_hypothesis")
    return tf.tensor1d([
      config.loss_weight_range,
      config.loss_weight_speed,
      config.loss_weight_speed,
      0,
    ]);
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

/** Two-hypothesis loss parts (spec 011): masked per-hypothesis squared error plus weighted BCE. */
export function twoHypothesisLossParts(
  w: tf.Tensor1D,
  bceWeight: number,
  yTrue: tf.Tensor,
  yPred: tf.Tensor,
): { num: tf.Scalar; den: tf.Scalar } {
  const target = yTrue.slice([0, 0, 0], [-1, -1, 3]);
  const label = yTrue.slice([0, 0, 3], [-1, -1, 1]).squeeze([2]);
  const weight = yTrue.slice([0, 0, NO], [-1, -1, 1]).squeeze([2]);
  const w3 = w.slice([0], [3]);
  const err = (k: number): tf.Tensor =>
    yPred.slice([0, 0, k], [-1, -1, 3]).sub(target).square().mul(w3).sum(2);
  const held = err(0).mul(tf.scalar(1).sub(label));
  const turned = err(3).mul(label);
  const z = yPred.slice([0, 0, 6], [-1, -1, 1]).squeeze([2]);
  // Numerically stable BCE with logits: max(z, 0) − z·l + log(1 + e^(−|z|)).
  const bce = tf
    .relu(z)
    .sub(z.mul(label))
    .add(tf.log1p(tf.exp(tf.neg(tf.abs(z)))));
  const perRow = held.add(turned).add(bce.mul(bceWeight));
  return { num: perRow.mul(weight).sum(), den: weight.sum() };
}

/** The loss parts a config trains with (validation loss uses the same). */
export function lossPartsFor(
  config: TrainingConfig,
  w: tf.Tensor1D,
): (yTrue: tf.Tensor, yPred: tf.Tensor) => { num: tf.Scalar; den: tf.Scalar } {
  if (outputSpec(config).parameterisation === "velocity_two_hypothesis") {
    const bw = config.loss_weight_manoeuvre ?? 1;
    return (y, p) => twoHypothesisLossParts(w, bw, y, p);
  }
  return (y, p) => lossParts(w, y, p);
}

export function makeLoss(
  config: TrainingConfig,
): (yTrue: tf.Tensor, yPred: tf.Tensor) => tf.Scalar {
  const w = termWeights(config);
  if (outputSpec(config).parameterisation === "velocity_two_hypothesis") {
    const bw = config.loss_weight_manoeuvre ?? 1;
    return (yTrue, yPred) =>
      tf.tidy(() => {
        const { num, den } = twoHypothesisLossParts(w, bw, yTrue, yPred);
        return num.div(tf.maximum(den, 1));
      });
  }
  return (yTrue, yPred) =>
    tf.tidy(() => {
      const { num, den } = lossParts(w, yTrue, yPred);
      return num.div(tf.maximum(den, 1));
    });
}

export { termWeights };
