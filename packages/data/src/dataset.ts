import { openPackWriter, readPack } from "./f32pack.js";
import { type Dataset, type DatasetWriter, openNdjsonWriter, readNdjson } from "./ndjson.js";
import { canonicalJson } from "./canonical.js";

/** Open a dataset by extension (.ndjson or .f32pack); validates versions and records. */
export function readDataset(path: string): Dataset {
  if (path.endsWith(".ndjson")) return readNdjson(path);
  if (path.endsWith(".f32pack")) return readPack(path);
  throw new Error(`${path}: unknown dataset extension (expected .ndjson or .f32pack)`);
}

export function openDatasetWriter(path: string, header: Dataset["header"]): DatasetWriter {
  if (path.endsWith(".ndjson")) return openNdjsonWriter(path, header);
  if (path.endsWith(".f32pack")) return openPackWriter(path, header);
  throw new Error(`${path}: unknown dataset extension (expected .ndjson or .f32pack)`);
}

/** Lossless conversion between formats. */
export function convertDataset(input: string, output: string): number {
  const ds = readDataset(input);
  const w = openDatasetWriter(output, ds.header);
  let n = 0;
  try {
    for (const s of ds.scenarios()) {
      w.write(s);
      n++;
    }
    w.close();
  } catch (e) {
    w.abort();
    throw e;
  }
  return n;
}

/** True iff both files hold identical headers and scenarios (value-for-value). */
export function sameDataset(a: string, b: string): { same: boolean; detail: string } {
  const da = readDataset(a);
  const db = readDataset(b);
  if (canonicalJson(da.header) !== canonicalJson(db.header)) {
    return { same: false, detail: "headers differ" };
  }
  const ib = db.scenarios();
  let i = 0;
  for (const sa of da.scenarios()) {
    const sb = ib.next();
    if (sb.done === true) return { same: false, detail: `${b} ends at scenario ${String(i)}` };
    if (canonicalJson(sa) !== canonicalJson(sb.value)) {
      return { same: false, detail: `scenario ${String(i)} differs` };
    }
    i++;
  }
  if (ib.next().done !== true) return { same: false, detail: `${a} ends at scenario ${String(i)}` };
  return { same: true, detail: `${String(i)} scenarios identical` };
}
