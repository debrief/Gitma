import { RecordError, SCHEMA_VERSION } from "@tma/types";
import { GENERATOR_VERSION } from "@tma/sim";

const parts = (v: string): [number, number] => {
  const [major = NaN, minor = NaN] = v.split(".").map(Number);
  return [major, minor];
};

/** Compatible when MAJOR matches and the file's MINOR is not newer than this build's. */
function compatible(file: string, build: string): boolean {
  const [fMaj, fMin] = parts(file);
  const [bMaj, bMin] = parts(build);
  return fMaj === bMaj && fMin <= bMin;
}

/**
 * Generator versions whose files this build reads. 0.2.0 (rate-limited turn) reproduces 0.1.0
 * byte for byte when the ranges have no turn rate, and 0.3.0 (second zig, across-LOS rule)
 * reproduces 0.2.0 when the ranges have neither, so earlier datasets stay readable.
 */
export const READABLE_GENERATOR_VERSIONS: readonly string[] = ["0.1.0", "0.2.0", GENERATOR_VERSION];

/** Reject files from an incompatible schema version or an unknown generator version (FR-007). */
export function checkVersions(
  file: string,
  header: { schema_version: string; generator_version?: string },
): void {
  if (!compatible(header.schema_version, SCHEMA_VERSION)) {
    throw new RecordError(
      file,
      "header",
      `schema version ${header.schema_version} is incompatible with this build (${SCHEMA_VERSION})`,
    );
  }
  if (
    header.generator_version !== undefined &&
    !READABLE_GENERATOR_VERSIONS.includes(header.generator_version)
  ) {
    throw new RecordError(
      file,
      "header",
      `generator version ${header.generator_version} does not match this build (${GENERATOR_VERSION}); regenerate the dataset`,
    );
  }
}
