// Settings from estimator names (spec 015 FR-001). Every tracker's name is a pure function of its
// settings (immName, ekfName, fusedName, trackerHybridName), and decision records freeze those
// names. These parsers invert them so that a gate can re-compute rows from the settings a name
// declares. Each parse is checked by a round trip: the settings must give back the very same name,
// so an ambiguous or non-canonical name is refused rather than read loosely.
import { type CompositeParams, compositeName } from "./composite.js";
import { ekfName, type TrackerScales } from "./ekf.js";
import { type FusionParams, fusedEkfName, fusedName } from "./fused.js";
import { type CusumParams, courseRateName, cusumName } from "./detect.js";
import { trackerHybridName } from "./hybrid.js";
import { type ImmParams, immName } from "./imm.js";

/** A number as `String(x)` prints it for the settings these names carry. */
const NUM = String.raw`(\d+(?:\.\d+)?(?:e[-+]?\d+)?)`;
const SCALES = String.raw`(?:-p${NUM})?(?:-r${NUM})?(?:-g([12]))?`;
const IMM_RE = new RegExp(
  String.raw`^imm-cv${NUM}-ct${NUM}-w${NUM}-s${NUM}${SCALES}(?:-b${NUM}-tb${NUM})?(-sd)?$`,
);
const EKF_RE = new RegExp(String.raw`^ekf-sa${NUM}${SCALES}$`);
const FUSION_RE = new RegExp(String.raw`-k${NUM}-m(\d+)$`);
const FUSION_FADE_RE = new RegExp(String.raw`-k${NUM}-m(\d+)(?:-f${NUM})?$`);
const HYBRID_RE = new RegExp(String.raw`^${NUM}$`);

const scales = (
  p: string | undefined,
  r: string | undefined,
  g: string | undefined,
): TrackerScales => ({
  ...(p === undefined ? {} : { p0Scale: Number(p) }),
  ...(r === undefined ? {} : { rScale: Number(r) }),
  ...(g === undefined ? {} : { guardedInit: Number(g) === 2 ? 2 : 1 }),
});

/** The IMM settings `name` declares, or null if it is not an IMM's canonical name. */
export function parseImmName(name: string): ImmParams | null {
  const m = IMM_RE.exec(name);
  if (m === null) return null;
  const [, cv, ct, w, sw, p, r, g, b, tb, sd] = m;
  const params: ImmParams = {
    sigmaCv: Number(cv),
    sigmaCt: Number(ct),
    sigmaOmega: Number(w),
    switchPerS: Number(sw),
    ...scales(p, r, g),
    ...(b === undefined || tb === undefined ? {} : { biasSdDeg: Number(b), biasTauS: Number(tb) }),
    ...(sd === undefined ? {} : { reportSd: true }),
  };
  return immName(params) === name ? params : null;
}

/** The EKF settings `name` declares, or null if it is not an EKF's canonical name. */
export function parseEkfName(name: string): { sigmaA: number; scales: TrackerScales } | null {
  const m = EKF_RE.exec(name);
  if (m === null) return null;
  const [, sa, p, r, g] = m;
  const out = { sigmaA: Number(sa), scales: scales(p, r, g) };
  return ekfName(out.sigmaA, out.scales) === name ? out : null;
}

/** The fused tracker's settings `name` declares over `network`, or null. */
export function parseFusedName(
  name: string,
  network: string,
): { imm: ImmParams; fusion: FusionParams } | null {
  const prefix = `fused-${network}-`;
  if (!name.startsWith(prefix)) return null;
  const rest = name.slice(prefix.length);
  const m = FUSION_RE.exec(rest);
  if (m === null) return null;
  const imm = parseImmName(rest.slice(0, m.index));
  if (imm === null) return null;
  const fusion: FusionParams = { k: Number(m[1]), every: Number(m[2]) };
  return fusedName(network, imm, fusion) === name ? { imm, fusion } : null;
}

/** The EKF-fused tracker's settings `name` declares over `network` (spec 028), or null. */
export function parseFusedEkfName(
  name: string,
  network: string,
): { sigmaA: number; scales: TrackerScales; fusion: FusionParams } | null {
  const prefix = `fused-${network}-`;
  if (!name.startsWith(prefix)) return null;
  const rest = name.slice(prefix.length);
  const m = FUSION_FADE_RE.exec(rest);
  if (m === null) return null;
  const ekf = parseEkfName(rest.slice(0, m.index));
  if (ekf === null) return null;
  const fusion: FusionParams = {
    k: Number(m[1]),
    every: Number(m[2]),
    ...(m[3] === undefined ? {} : { fade: Number(m[3]) }),
  };
  return fusedEkfName(network, ekf.sigmaA, ekf.scales, fusion) === name ? { ...ekf, fusion } : null;
}

/** The tracker hybrid's course threshold (degrees) `name` declares over its inputs, or null. */
export function parseTrackerHybridName(
  name: string,
  network: string,
  tracker: string,
): number | null {
  const prefix = `hybrid-${network}-${tracker}-c`;
  if (!name.startsWith(prefix)) return null;
  const m = HYBRID_RE.exec(name.slice(prefix.length));
  if (m === null) return null;
  const deg = Number(m[1]);
  return trackerHybridName(network, tracker, deg) === name ? deg : null;
}

/** The CUSUM detector's IMM settings and CUSUM settings `name` declares (spec 017), or null. */
export function parseCusumName(name: string): { imm: ImmParams; cusum: CusumParams } | null {
  const head = /^cusum-(nis|mean)-/.exec(name);
  if (head === null) return null;
  const m = new RegExp(String.raw`-c${NUM}-x${NUM}$`).exec(name);
  if (m === null) return null;
  const imm = parseImmName(name.slice(head[0].length, m.index));
  if (imm === null) return null;
  const cusum: CusumParams = {
    kind: head[1] === "mean" ? "mean" : "nis",
    c: Number(m[1]),
    clip: Number(m[2]),
  };
  return cusumName(imm, cusum) === name ? { imm, cusum } : null;
}

/** The course-rate detector's window `name` declares over `network`, or null. */
export function parseCourseRateName(name: string, network: string): number | null {
  const prefix = `crate-${network}-w`;
  if (!name.startsWith(prefix) || !/^\d+$/.test(name.slice(prefix.length))) return null;
  const w = Number(name.slice(prefix.length));
  return courseRateName(network, w) === name ? w : null;
}

const COMPOSITE_RE = new RegExp(String.raw`^-w(\d+)-c${NUM}(?:-l(\d+)-p${NUM})?$`);

/**
 * The composite's settings (spec 025) that `name` declares for these classical and fused input
 * names, or null if it is not their composite's canonical name.
 */
export function parseCompositeName(
  name: string,
  classical: string,
  fused: string,
): CompositeParams | null {
  const prefix = `composite-${classical}-${fused}`;
  if (!name.startsWith(prefix)) return null;
  const m = COMPOSITE_RE.exec(name.slice(prefix.length));
  if (m === null) return null;
  const p: CompositeParams = {
    window: Number(m[1]),
    threshold: Number(m[2]),
    ...(m[3] === undefined ? {} : { leg: Number(m[3]), priorSd: Number(m[4]) }),
  };
  if (!(p.window >= 1) || !(p.threshold > 0)) return null;
  if (p.leg !== undefined && (!(p.leg >= 1) || !((p.priorSd ?? 0) > 0))) return null;
  return compositeName(classical, fused, p) === name ? p : null;
}
