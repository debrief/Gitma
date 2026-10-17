// T005: the viewer renders on the server (as Docusaurus pre-renders pages) in every mode, from a
// URL, without a browser or tfjs. Inference runs in an effect, so the model status reads "Running".
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ModelEntry, ModelPair, ViewerCatalogue } from "../src/index.js";
import { EngagementViewer } from "../src/viewer/index.js";
import { I1_TEST, I2_TEST, repoPath } from "./helpers.js";

const NORM = (
  JSON.parse(
    readFileSync(
      repoPath("experiments/20261016-i2d-val/models/lstm-instantaneous/manifest.json"),
      "utf8",
    ),
  ) as { normalisation: ModelEntry["normalisation"] }
).normalisation;
const entry = (id: string, variant: ModelEntry["variant"]): ModelEntry => ({
  id,
  variant,
  path: `x/${id}`,
  featureSet: "raw",
  normalisation: NORM,
  parameterCount: 1234,
  architecture: "LSTM 2 × 128",
  trainedOnSeed: "201",
  bestEpoch: 7,
});
const pair: ModelPair = {
  id: "2c",
  label: "Iteration 2c",
  experiment: "experiments/x",
  gate: "G2",
  instantaneous: entry("lstm-instantaneous", "instantaneous"),
  timeLate: entry("bilstm-time-late", "time_late"),
  naive: { log_range_km: 2, course_sin: 0, course_cos: 1, speed_mps: 5.9, n: 1 },
};
const cat: ViewerCatalogue = {
  generatorVersion: "0.2.0",
  sources: [I2_TEST, I1_TEST],
  pairs: [pair],
  bookmarks: [{ label: "typical", source: "i2-test", index: 90003 }],
};
const render = (search: string): string =>
  renderToString(
    <EngagementViewer catalogue={cat} modelBaseUrl="/m" initialSearch={search} />,
  ).replaceAll("<!-- -->", "");

describe("server render", () => {
  it("truth mode: plan, plots and metadata, no estimates", () => {
    const html = render("src=i2-test&i=90001");
    expect(html).toContain('aria-label="Plan view"');
    for (const t of ["Course", "Speed", "Bearing", "Bearing rate", "Range"])
      expect(html).toContain(`aria-label="${t}"`);
    expect(html).toContain("index 90001");
    expect(html).toContain("generator</td>");
    expect(html).not.toContain("At the cursor");
    expect(html).toContain("typical");
  });
  it("instantaneous mode: model status, readout with classical and naive", () => {
    const html = render("src=i2-test&i=90002&mode=instantaneous&t=1200");
    expect(html).toContain("Running lstm-instantaneous");
    expect(html).toContain("At the cursor");
    expect(html).toContain("classical (error)");
    expect(html).toContain("naive (error)");
    expect(html).toContain("post-zig medians");
    expect(html).toContain("unobservable");
  });
  it("time-late mode on another dataset notes the seed difference", () => {
    const html = render("src=i1-test&i=90005&mode=time-late&cl=0");
    expect(html).toContain("Running bilstm-time-late");
    expect(html).not.toContain("classical (error)");
    expect(html).toContain("different dataset (seed 101)");
  });
  it("falls back to defaults on a bad URL", () => {
    const html = render("src=nope&i=-4&mode=zz");
    expect(html).toContain("index 90000");
    expect(html).not.toContain("At the cursor");
  });
});
