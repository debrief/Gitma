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

/** Reject files from an incompatible schema version or a different generator version (FR-007). */
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
  if (header.generator_version !== undefined && header.generator_version !== GENERATOR_VERSION) {
    throw new RecordError(
      file,
      "header",
      `generator version ${header.generator_version} does not match this build (${GENERATOR_VERSION}); regenerate the dataset`,
    );
  }
}
