// Spec 017 research (validation; reported, not gated): each detector calibrated at several
// false-alarm rates on quiet rows, with its detected-within-5-min rate, miss rate and median
// delay among detected course-change events.
//   node scripts/research/spec017-sensitivity.mjs <validation.f32pack> <rates,comma> <scores.ndjson>...
import { scenarioSource } from "../../packages/eval/dist/prediction-file.js";
import { readDetectionSet } from "../../packages/eval/dist/detection-file.js";
import { calibrateThreshold, detectorOutcome, g6Events } from "../../packages/eval/dist/gate-g6.js";

const [truth, ratesArg, ...files] = process.argv.slice(2);
const rates = ratesArg.split(",").map(Number);
const { events, scenarios } = g6Events(Array.from(scenarioSource(truth)));
const out = [];
for (const f of files) {
  const set = readDetectionSet(f, truth);
  for (const r of rates) {
    const { threshold, rate } = calibrateThreshold(scenarios, set.byIndex, r);
    const o = detectorOutcome(events, scenarios, set.byIndex, threshold);
    const det = Array.from(o.delays)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    out.push({
      detector: set.detector,
      target_per_hour: r,
      false_alarms_per_hour: rate,
      threshold,
      detected_within_5min: Array.from(o.delays).filter((d) => d <= 300).length / o.delays.length,
      missed: 1 - det.length / o.delays.length,
      median_delay_detected_s: det.length ? det[Math.floor((det.length - 1) / 2)] : null,
    });
  }
}
console.log(
  JSON.stringify({ events: events.length, scenarios: scenarios.length, results: out }, null, 2),
);
