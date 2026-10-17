// Colours and layout for the viewer. Plots draw on their own light background so they read the
// same in light and dark site themes and in PNG exports.
export const C = {
  paper: "#ffffff",
  ink: "#1f2328",
  muted: "#6e7781",
  grid: "#d8dee4",
  gridMajor: "#afb8c1",
  own: "#0969da",
  turn: "#bf8700",
  target: "#cf222e",
  bearing: "#57606a",
  trueBearing: "#8250df",
  model: "#8250df",
  classical: "#1a7f37",
  naive: "#9a6700",
  cursor: "#24292f",
  gate: "#bc4c00",
} as const;

export const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

/** Scoped CSS for the viewer's layout (one class prefix, no global rules). */
export const CSS = `
.tmav { font-family: ${FONT}; font-size: 14px; }
.tmav-bar { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 8px 0 12px; }
.tmav-bar label { display: inline-flex; gap: 6px; align-items: center; }
.tmav-bar input[type=number] { width: 7.5em; }
.tmav-bar select { max-width: 24em; }
.tmav-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 960px) { .tmav-grid { grid-template-columns: minmax(0, 1fr); } }
.tmav-panel { border: 1px solid var(--ifm-color-emphasis-300, #d0d7de); border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; overflow-x: auto; }
.tmav-panel h3 { font-size: 15px; margin: 4px 0 8px; }
.tmav table { font-size: 13px; border-collapse: collapse; margin: 0; display: table; width: 100%; }
.tmav td, .tmav th { padding: 2px 8px; border: none; text-align: right; white-space: nowrap; }
.tmav td:first-child, .tmav th:first-child { text-align: left; }
.tmav tr:nth-child(2n) { background: transparent; }
.tmav-note { color: var(--ifm-color-emphasis-700, #57606a); font-size: 13px; }
.tmav-warn { color: #bc4c00; font-size: 13px; }
.tmav-svg { width: 100%; height: auto; display: block; border-radius: 6px; touch-action: none; }
.tmav-slider { width: 100%; }
`;
