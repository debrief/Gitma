import type { z } from "zod";

/** A validation failure that names the file and record (spec edge case: fail loudly). */
export class RecordError extends Error {
  constructor(
    readonly file: string,
    readonly record: number | string,
    message: string,
  ) {
    super(`${file}:${String(record)}: ${message}`);
    this.name = "RecordError";
  }
}

/** Validate one decoded record against a generated schema, or throw a RecordError. */
export function parseRecord<S extends z.ZodType>(
  schema: S,
  value: unknown,
  file: string,
  record: number | string,
): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue === undefined ? "" : `${issue.path.join(".")}: `;
    throw new RecordError(file, record, `${where}${issue?.message ?? "invalid record"}`);
  }
  return result.data;
}
