// The learned-gain filter (spec 012 tracker T1; SRD Annex C §C.4; constitution 1.3.0 principle III,
// a declared filter layer). A constant-velocity prediction and a bearings-only update whose gain a
// GRU computes each step (KalmanNet-style). Built from standard tensor operations only, unrolled
// over time, so autodiff trains it end to end; the equations are stated exactly here and in
// site/docs/algorithms/learned-gain-filter.md so that a Keras custom layer can reproduce them.
//
// Input: the raw feature set, [B, T, 10] (bearing sin/cos, ownship x/y scaled, course sin/cos,
// speed, time scaled, valid, window mask). Units are the features' scaled units throughout
// (positions / position_scale_km, time / time_scale_s); the output head's trainable scale and
// offset map them to the velocity parameterisation's targets.
//
// State per scenario: p (2), v (2), started (0/1), t_prev, h (GRU, `units`). Each step k:
//   τ      = (t_k − t_prev) · window_k                      (0 on padding)
//   p⁻     = p + v τ,  v⁻ = v                                (constant-velocity prediction)
//   d      = p⁻ − o_k (+ (0, 1) before the first bearing),  r = √(|d|² + ε²),  (sb, cb) = d / r
//   ν      = atan2(sz·cb − cz·sb, cz·cb + sz·sb) · valid    (wrapped innovation; on rows without a
//            bearing (sz, cz) is replaced by (sb, cb), so ν = 0 with finite gradients)
//   f      = [ν·valid, valid, log r, τ, v⁻ₓ, v⁻ᵧ]             (gain features)
//   h      = GRU(f, h)                                       (standard GRU equations, below)
//   K      = κ · tanh(W_K h + b_K)                           (4 gains: pₓ, pᵧ, vₓ, vᵧ)
//   start  = valid · (1 − started)                           (first valid bearing)
//   p      = start · (o_k + R₀ (sz, cz)) + (1 − start) · (p⁻ + K_p ν valid)
//   v      = (1 − start) · (v⁻ + K_v ν valid)
//   p, v clipped to ±P_BOUND, ±V_BOUND (scaled units);  started = max(started, valid)
// with R₀ = exp(ρ) a trainable initial range and κ a fixed gain bound. GRU (input f, state h):
//   zg = σ(W_z f + U_z h + b_z),  rg = σ(W_r f + U_r h + b_r)
//   ĥ = tanh(W_h f + U_h (rg ⊙ h) + b_h),  h = (1 − zg) ⊙ h + zg ⊙ ĥ
// Output per row: [log(r_p · e^λ), α vₓ, α vᵧ, 0] with r_p = √(|p − o_k|² + ε²) and λ, α trainable
// (λ maps scaled range to km; α maps scaled velocity to v / velocity_scale_mps).
import * as tf from "@tensorflow/tfjs-node";

/** Raw input channels the filter reads. */
const CH = { sin: 0, cos: 1, ox: 2, oy: 3, time: 7, valid: 8, mask: 9 } as const;
const EPS = 1e-6;
/** Gain bound κ: |K| ≤ κ per component (scaled units per radian). */
export const GAIN_BOUND = 1;
/** State bounds in scaled units (|p| ≤ 10 position scales, |v| ≤ 5 velocity units ≈ 30 m/s). */
export const P_BOUND = 10;
export const V_BOUND = 5;
/** Gain features f per step. */
export const GAIN_FEATURES = 6;

export interface LearnedGainFilterArgs {
  units: number;
  seed: number;
  name?: string;
  /** [rows | null, 10], when it is a model's first layer. */
  inputShape?: (number | null)[];
  /** As saved by getConfig (restoring a model). */
  batchInputShape?: (number | null)[];
}

/** The filter state, one row per scenario. */
export interface FilterState {
  p: tf.Tensor2D;
  v: tf.Tensor2D;
  started: tf.Tensor2D;
  tPrev: tf.Tensor2D;
  h: tf.Tensor2D;
}

export class LearnedGainFilter extends tf.layers.Layer {
  static className = "LearnedGainFilter";
  readonly units: number;
  readonly seed: number;
  private w: Record<string, tf.LayerVariable> = {};

  constructor(args: LearnedGainFilterArgs) {
    super({
      ...(args.name === undefined ? {} : { name: args.name }),
      ...(args.inputShape === undefined ? {} : { inputShape: args.inputShape }),
      ...(args.batchInputShape === undefined ? {} : { batchInputShape: args.batchInputShape }),
    });
    this.units = args.units;
    this.seed = args.seed;
  }

  override build(): void {
    const u = this.units;
    const f = GAIN_FEATURES;
    let i = 0;
    const glorot = (): ReturnType<typeof tf.initializers.zeros> =>
      tf.initializers.glorotUniform({ seed: this.seed + i++ });
    const orth = (): ReturnType<typeof tf.initializers.zeros> =>
      tf.initializers.orthogonal({ seed: this.seed + i++ });
    const add = (
      name: string,
      shape: number[],
      init: ReturnType<typeof tf.initializers.zeros>,
    ): void => {
      this.w[name] = this.addWeight(name, shape, "float32", init);
    };
    for (const g of ["z", "r", "h"]) {
      add(`W_${g}`, [f, u], glorot());
      add(`U_${g}`, [u, u], orth());
      add(`b_${g}`, [u], tf.initializers.zeros());
    }
    // Near-zero initial gains: an untrained filter coasts on its prediction instead of diverging.
    add(
      "W_K",
      [u, 4],
      tf.initializers.randomUniform({ minval: -0.01, maxval: 0.01, seed: this.seed + i++ }),
    );
    add("b_K", [4], tf.initializers.zeros());
    // log R₀ in scaled units (about 0.6 of the position scale), log km per scaled unit, velocity scale.
    add("rho", [1], tf.initializers.constant({ value: Math.log(0.6) }));
    add("lambda", [1], tf.initializers.zeros());
    add("alpha", [1], tf.initializers.ones());
    this.built = true;
  }

  override computeOutputShape(inputShape: tf.Shape | tf.Shape[]): tf.Shape {
    const s = inputShape as tf.Shape;
    return [s[0] ?? null, s[1] ?? null, 4];
  }

  private v(name: string): tf.Tensor {
    const x = this.w[name];
    if (x === undefined) throw new Error(`LearnedGainFilter: no weight ${name}`);
    return x.read();
  }

  /** One step of the recursion (the equations above); `x` is [B, 10]. Exported for tests. */
  step(
    x: tf.Tensor2D,
    st: FilterState,
    gainOverride?: tf.Tensor2D,
  ): { st: FilterState; out: tf.Tensor2D } {
    const col = (c: number): tf.Tensor2D => x.slice([0, c], [-1, 1]);
    const sz = col(CH.sin);
    const cz = col(CH.cos);
    const o = tf.concat([col(CH.ox), col(CH.oy)], 1);
    const t = col(CH.time);
    const valid = col(CH.valid);
    const mask = col(CH.mask);
    const tau = t.sub(st.tPrev).mul(mask).mul(st.started);
    const pPred = st.p.add(st.v.mul(tau));
    // Before the first bearing there is no estimate: offset d by one unit north so the bearing,
    // its atan2 and the square root stay differentiable (0 · NaN would poison the gradients).
    const unstarted = tf.scalar(1).sub(st.started);
    const d = pPred.sub(o).add(tf.concat([tf.zerosLike(unstarted), unstarted], 1));
    const r = d
      .square()
      .sum(1, true)
      .add(EPS * EPS)
      .sqrt();
    const sb = d.slice([0, 0], [-1, 1]).div(r);
    const cb = d.slice([0, 1], [-1, 1]).div(r);
    // Without a bearing (dropout or padding: sin = cos = 0) use the predicted one, so atan2 sees
    // (0, 1) and ν = 0 with finite gradients (atan2(0, 0) would make them NaN).
    const invalid = tf.scalar(1).sub(valid);
    const zs = sz.add(invalid.mul(sb));
    const zc = cz.add(invalid.mul(cb));
    const nu = tf.atan2(zs.mul(cb).sub(zc.mul(sb)), zc.mul(cb).add(zs.mul(sb))).mul(valid);
    const feat = tf.concat([nu, valid, tf.log(r), tau, st.v], 1);
    const gate = (g: string, h: tf.Tensor2D): tf.Tensor2D =>
      feat
        .matMul(this.v(`W_${g}`) as tf.Tensor2D)
        .add(h.matMul(this.v(`U_${g}`) as tf.Tensor2D))
        .add<tf.Tensor2D>(this.v(`b_${g}`));
    const zg = tf.sigmoid(gate("z", st.h));
    const rg = tf.sigmoid(gate("r", st.h));
    const hHat = tf.tanh(gate("h", rg.mul(st.h)));
    const h = tf.scalar(1).sub(zg).mul(st.h).add<tf.Tensor2D>(zg.mul(hHat));
    const k =
      gainOverride ??
      tf
        .tanh(h.matMul(this.v("W_K") as tf.Tensor2D).add(this.v("b_K")))
        .mul<tf.Tensor2D>(GAIN_BOUND);
    const start = valid.mul(tf.scalar(1).sub(st.started));
    const keep = tf.scalar(1).sub(start);
    const r0 = tf.exp(this.v("rho"));
    const pInit = o.add(tf.concat([sz, cz], 1).mul(r0));
    const p = tf.clipByValue(
      start.mul(pInit).add(keep.mul(pPred.add(k.slice([0, 0], [-1, 2]).mul(nu)))),
      -P_BOUND,
      P_BOUND,
    ) as tf.Tensor2D;
    const vNew = tf.clipByValue(
      keep.mul(st.v.add(k.slice([0, 2], [-1, 2]).mul(nu))),
      -V_BOUND,
      V_BOUND,
    ) as tf.Tensor2D;
    const started = tf.maximum<tf.Tensor2D>(st.started, valid);
    const tPrev = mask.mul(t).add<tf.Tensor2D>(tf.scalar(1).sub(mask).mul(st.tPrev));
    const rp = p
      .sub(o)
      .square()
      .sum(1, true)
      .add(EPS * EPS)
      .sqrt();
    const out = tf.concat(
      [tf.log(rp).add(this.v("lambda")), vNew.mul(this.v("alpha")), tf.zerosLike(rp)],
      1,
    ) as tf.Tensor2D;
    return { st: { p, v: vNew, started, tPrev, h }, out };
  }

  /** The initial state for a batch of `b` scenarios. */
  initialState(b: number): FilterState {
    return {
      p: tf.zeros([b, 2]),
      v: tf.zeros([b, 2]),
      started: tf.zeros([b, 1]),
      tPrev: tf.zeros([b, 1]),
      h: tf.zeros([b, this.units]),
    };
  }

  override call(inputs: tf.Tensor | tf.Tensor[]): tf.Tensor {
    return tf.tidy(() => {
      const x0 = Array.isArray(inputs) ? inputs[0] : inputs;
      if (x0 === undefined) throw new Error("LearnedGainFilter: no input");
      const x = x0 as tf.Tensor3D;
      const [b, rows] = x.shape;
      let st = this.initialState(b);
      const outs: tf.Tensor2D[] = [];
      const steps = tf.unstack(x, 1) as tf.Tensor2D[];
      for (let k = 0; k < rows; k++) {
        const xk = steps[k];
        if (xk === undefined) break;
        const r = this.step(xk, st);
        st = r.st;
        outs.push(r.out);
      }
      return tf.stack(outs, 1);
    });
  }

  override getConfig(): tf.serialization.ConfigDict {
    return { ...super.getConfig(), units: this.units, seed: this.seed };
  }
}
tf.serialization.registerClass(LearnedGainFilter);
