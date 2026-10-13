// TensorFlow thread pools (research R15). Must not import tfjs-node: libtensorflow reads
// TF_NUM_INTRAOP_THREADS and TF_NUM_INTEROP_THREADS once, when tfjs-node loads and creates its
// eager context, so they have to be in the process environment before the first import of it.
// Node's process.env assignments call setenv(3), which the native library's getenv sees.

export const INTRAOP_ENV = "TF_NUM_INTRAOP_THREADS";
export const INTEROP_ENV = "TF_NUM_INTEROP_THREADS";

/** Sets both thread counts. Call before tfjs-node is imported; afterwards it has no effect. */
export function applyThreads(threads: number): void {
  if (!Number.isInteger(threads) || threads < 1) {
    throw new Error(`tfjs_threads must be a positive integer, got ${String(threads)}`);
  }
  process.env[INTRAOP_ENV] = String(threads);
  process.env[INTEROP_ENV] = String(threads);
}

function readEnv(name: string): number | undefined {
  const v = process.env[name];
  if (v === undefined || !/^\d+$/.test(v.trim())) return undefined;
  return Number(v.trim());
}

/**
 * The thread settings in force, for the model manifest. A field is absent when its variable is
 * unset (or not an integer), meaning TensorFlow's default (one thread per core).
 */
export function threadSettings(): { tf_intraop_threads?: number; tf_interop_threads?: number } {
  const intra = readEnv(INTRAOP_ENV);
  const inter = readEnv(INTEROP_ENV);
  return {
    ...(intra === undefined ? {} : { tf_intraop_threads: intra }),
    ...(inter === undefined ? {} : { tf_interop_threads: inter }),
  };
}
