// Spec 030 (Annex H §H.2, reported): each detector's detected-within-5-min rate and median delay
// among detected events at 0.5, 1, 2 and 5 false alarms per quiet hour, thresholds set on the same
// split. Prints JSON.  node scripts/research/spec030-rates.mjs <truth> <detection.ndjson>...
import { readDetectionSet } from "../../packages/eval/dist/detection-file.js";
import { calibrateThreshold, detectorOutcome, g6Events } from "../../packages/eval/dist/gate-g6.js";
import { scenarioSource } from "../../packages/eval/dist/prediction-file.js";

const [truth, ...paths] = process.argv.slice(2);
const scen = Array.from(scenarioSource(truth));
const { events, scenarios } = g6Events(scen);
const out = [];
for (const p of paths) {
  const set = readDetectionSet(p, truth);
  const row = { detector: set.detector, rates: {} };
  for (const fa of [0.5, 1, 2, 5]) {
    const { threshold, rate } = calibrateThreshold(scenarios, set.byIndex, fa);
    const o = detectorOutcome(events, scenarios, set.byIndex, threshold);
    const d = Array.from(o.delays);
    const hit = d.filter(Number.isFinite).sort((a, b) => a - b);
    row.rates[fa] = {
      threshold,
      achieved: rate,
      detected_within_5min: d.filter((x) => x <= 300).length / d.length,
      detected_within_10min: hit.length / d.length,
      median_delay_detected_s: hit[Math.floor((hit.length - 1) / 2)] ?? null,
    };
  }
  out.push(row);
}
console.log(JSON.stringify({ truth, events: events.length, detectors: out }, null, 2));
