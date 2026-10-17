// Smoke test of the built viewer page (spec 006 T008, SC-001, SC-002). Not part of `pnpm test`:
// it needs a served site and Playwright with Chromium, which the repo does not install.
//
//   pnpm site:build && (cd site && npx docusaurus serve --port 3123 --no-open) &
//   node scripts/viewer-smoke.mjs [http://localhost:3123/Gitma/viewer] [screenshot dir]
//
// Playwright is loaded from $PLAYWRIGHT (a path to the package) or as `playwright`. Fails on any
// console error, a missing plan view, or a model that does not run; reports the inference times
// against SC-001 (2c BiLSTM under 2 s).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const base = process.argv[2] ?? "http://localhost:3123/Gitma/viewer";
const shots = process.argv[3] ?? null;
const pw = process.env.PLAYWRIGHT;
let chromium;
try {
  ({ chromium } = await import(
    pw === undefined ? "playwright" : pathToFileURL(join(pw, "index.mjs")).href
  ));
} catch {
  console.error("viewer-smoke: Playwright not found; set PLAYWRIGHT to its package directory");
  process.exit(2);
}
if (shots !== null) mkdirSync(shots, { recursive: true });

const views = [
  ["truth", "src=s203-test&i=90000"],
  ["instantaneous", "src=s203-test&i=97612&mode=instantaneous&t=1690&pair=i2c"],
  ["time-late", "src=s203-test&i=97612&mode=time-late&t=1690&pair=i2c"],
  ["held-out", "src=s201-heldout&i=102983&mode=time-late&t=1300&pair=i2c"],
  ["i1", "src=s101-test&i=90000&mode=instantaneous&pair=i1"],
  ["i2", "src=s201-test&i=90000&mode=time-late&pair=i2"],
  ["i2b", "src=s202-test&i=90000&mode=time-late&pair=i2b"],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));
const failures = [];
let bilstmMs = null;
for (const [name, query] of views) {
  await page.goto(`${base}?${query}`);
  await page.waitForSelector('svg[aria-label="Plan view"]', { timeout: 60_000 });
  let line = "";
  if (query.includes("mode=") && !query.includes("mode=truth")) {
    const status = page.locator('[data-testid="tmav-status"]');
    await status.filter({ hasText: /ms on the CPU|Could not run/ }).waitFor({ timeout: 120_000 });
    line = (await status.textContent()) ?? "";
    if (line.includes("Could not run")) failures.push(`${name}: ${line}`);
    const ms = /(\d+) ms/.exec(line);
    if (name === "time-late" && ms !== null) bilstmMs = Number(ms[1]);
  }
  if (shots !== null) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
  console.log(`${name}: ok ${line}`);
}
await browser.close();
if (errors.length > 0) failures.push(...errors.map((e) => `console: ${e}`));
console.log(
  `SC-001: 2c BiLSTM inference ${bilstmMs === null ? "not measured" : `${String(bilstmMs)} ms`} (target < 2000 ms)`,
);
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("viewer-smoke: pass");
