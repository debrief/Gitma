// NDJSON export (spec 006 FR-008): the scenario and the estimates shown, canonical JSON in the
// schema's types, so a viewed case can be fed back into the CLI pipeline.
import { canonicalJson } from "@tma/data/canonical";
import type { Prediction, Scenario } from "@tma/types";

export function viewNdjson(s: Scenario, predictions: readonly Prediction[]): string {
  return [s, ...predictions].map((r) => canonicalJson(r)).join("\n") + "\n";
}
