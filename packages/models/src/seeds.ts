import { parseSeed, splitmix64At } from "@tma/sim";

/** Stream offsets keep initializer seeds, epoch orders and label shuffles independent. */
const INIT_STREAM = 1_000;
const EPOCH_STREAM = 2_000_000;
const SHUFFLE_STREAM = 3_000_000;

/** A non-negative 31-bit seed for tfjs initializers, derived from the run's train seed. */
export function initSeed(trainSeed: string, i: number): number {
  return Number(splitmix64At(parseSeed(trainSeed), INIT_STREAM + i) & 0x7fffffffn);
}

export function epochSeed(trainSeed: string, epoch: number): bigint {
  return splitmix64At(parseSeed(trainSeed), EPOCH_STREAM + epoch);
}

export function shuffleSeed(trainSeed: string): bigint {
  return splitmix64At(parseSeed(trainSeed), SHUFFLE_STREAM);
}
