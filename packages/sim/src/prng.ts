// Seeded PRNG (research R2). SplitMix64 for seeding, xoshiro128** for the stream.
// State is explicit (a Uint32Array passed to every call), so there is no hidden state and the
// algorithm ports line-for-line to Python or Java.

const MASK64 = (1n << 64n) - 1n;
const GAMMA = 0x9e3779b97f4a7c15n;

/** SplitMix64 mix function (Steele, Lea, Flood 2014). */
function mix64(z0: bigint): bigint {
  let z = z0 & MASK64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}

/** The n-th output (0-based) of SplitMix64 seeded with `seed`. */
export function splitmix64At(seed: bigint, n: number): bigint {
  return mix64((seed & MASK64) + BigInt(n + 1) * GAMMA);
}

/** First `count` outputs of SplitMix64 seeded with `seed`. */
export function splitmix64(seed: bigint, count: number): bigint[] {
  return Array.from({ length: count }, (_, i) => splitmix64At(seed, i));
}

/** Parse a uint64 seed from a decimal string, rejecting anything out of range. */
export function parseSeed(text: string): bigint {
  if (!/^\d+$/.test(text)) throw new Error(`seed must be a decimal integer, got "${text}"`);
  const seed = BigInt(text);
  if (seed > MASK64) throw new Error(`seed exceeds 64 bits: ${text}`);
  return seed;
}

/** Seed for scenario `index` of a dataset: SplitMix64 output number `index`. */
export function deriveSeed(datasetSeed: bigint, index: number): bigint {
  return splitmix64At(datasetSeed, index);
}

/** xoshiro128** state: four uint32 words. */
export type RngState = Uint32Array;

/** Create xoshiro128** state from a 64-bit seed via two SplitMix64 outputs. */
export function createRng(seed: bigint): RngState {
  const [a, b] = splitmix64(seed, 2) as [bigint, bigint];
  const s = new Uint32Array([
    Number(a & 0xffffffffn),
    Number(a >> 32n),
    Number(b & 0xffffffffn),
    Number(b >> 32n),
  ]);
  if (s.every((w) => w === 0)) s[0] = 1;
  return s;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Next uint32 from xoshiro128** (Blackman & Vigna 2018). Mutates `s`. */
export function nextU32(s: RngState): number {
  const s0 = s[0] ?? 0;
  const s1 = s[1] ?? 0;
  const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
  const t = (s1 << 9) >>> 0;
  const s2 = (s[2] ?? 0) ^ s0;
  const s3 = (s[3] ?? 0) ^ s1;
  s[1] = s1 ^ s2;
  s[0] = s0 ^ s3;
  s[2] = s2 ^ t;
  s[3] = rotl(s3, 11);
  return result;
}

/** Uniform double in [0, 1) with 53 random bits. */
export function uniform01(s: RngState): number {
  const a = nextU32(s) >>> 5;
  const b = nextU32(s) >>> 6;
  return (a * 67108864 + b) / 9007199254740992;
}

/** Uniform double in [lo, hi). */
export function uniform(s: RngState, lo: number, hi: number): number {
  return lo + (hi - lo) * uniform01(s);
}

/** Log-uniform double in [lo, hi), lo > 0. */
export function logUniform(s: RngState, lo: number, hi: number): number {
  return Math.exp(uniform(s, Math.log(lo), Math.log(hi)));
}

/** Standard normal via Box–Muller; the second variate is discarded (stateless). */
export function gaussian(s: RngState): number {
  const u1 = 1 - uniform01(s);
  const u2 = uniform01(s);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Uniform integer in [0, n). */
export function uniformInt(s: RngState, n: number): number {
  return Math.floor(uniform01(s) * n);
}
