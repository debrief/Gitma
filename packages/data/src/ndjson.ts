// Inspection format (contracts/file-formats.md): line 1 DatasetHeader, then one Scenario per line.
import { DatasetHeader, parseRecord, RecordError, Scenario } from "@tma/types";
import { canonicalJson } from "./canonical.js";
import { openAtomic, readLines, writeAll } from "./io.js";
import { checkVersions } from "./versions.js";

export interface DatasetWriter {
  write(s: Scenario): void;
  close(): void;
  abort(): void;
}

export interface Dataset {
  header: DatasetHeader;
  scenarios: () => Generator<Scenario>;
}

const enc = new TextEncoder();

export function openNdjsonWriter(path: string, header: DatasetHeader): DatasetWriter {
  const f = openAtomic(path);
  writeAll(f.fd, enc.encode(`${canonicalJson(header)}\n`));
  let written = 0;
  return {
    write(s) {
      writeAll(f.fd, enc.encode(`${canonicalJson(s)}\n`));
      written++;
    },
    close() {
      if (written !== header.scenario_count) {
        f.abort();
        throw new Error(`${path}: wrote ${String(written)} of ${String(header.scenario_count)}`);
      }
      f.commit();
    },
    abort() {
      f.abort();
    },
  };
}

function parseJson(file: string, line: number, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new RecordError(file, line, "malformed JSON (truncated or corrupted file?)");
  }
}

export function readNdjson(path: string): Dataset {
  const first = readLines(path).next();
  if (first.done === true) throw new RecordError(path, 1, "empty file");
  const [, headerText] = first.value;
  const header = parseRecord(DatasetHeader, parseJson(path, 1, headerText), path, 1);
  checkVersions(path, header);
  return {
    header,
    *scenarios() {
      let count = 0;
      for (const [lineNo, text] of readLines(path)) {
        if (lineNo === 1) continue;
        if (text === "") throw new RecordError(path, lineNo, "blank line");
        yield parseRecord(Scenario, parseJson(path, lineNo, text), path, lineNo);
        count++;
      }
      if (count !== header.scenario_count) {
        throw new RecordError(
          path,
          "end",
          `header declares ${String(header.scenario_count)} scenarios, file has ${String(count)}`,
        );
      }
    },
  };
}
