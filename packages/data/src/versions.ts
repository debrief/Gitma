import { RecordError, SCHEMA_VERSION } from "@tma/types";
import { GENERATOR_VERSION } from "@tma/sim";

const majorMinor = (v: string): string => v.split(".").slice(0, 2).join(".");

/** Reject files written by a different schema MAJOR.MINOR or generator version (FR-007). */
export function checkVersions(
  file: string,
  header: { schema_version: string; generator_version?: string },
): void {
  if (majorMinor(header.schema_version) !== majorMinor(SCHEMA_VERSION)) {
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
