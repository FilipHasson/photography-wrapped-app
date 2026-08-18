/**
 * Exposure numbers, and how to bucket them so a histogram means something.
 *
 * Cameras record f/7.1 and 1/320 and ISO 320; photographers think in stops.
 * Every distribution on a slide is therefore snapped to the standard scale it
 * belongs to before it is counted, so "your favourite aperture" comes out as
 * f/2.8 rather than split three ways across f/2.8, f/2.9 and f/3.0.
 */

/** Standard third-stop apertures, from f/1 to f/45. */
const APERTURE_STOPS = [
  1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3,
  7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22, 25, 29, 32, 36, 40, 45,
];

/** Full-stop shutter speeds in seconds, 1/8000 to 30s. */
const SHUTTER_STOPS = [
  1 / 8000, 1 / 4000, 1 / 2000, 1 / 1000, 1 / 500, 1 / 250, 1 / 125, 1 / 60,
  1 / 30, 1 / 15, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 15, 30,
];

/** Focal lengths lenses are actually sold at — the vocabulary people use. */
const FOCAL_STOPS = [
  8, 10, 12, 14, 16, 18, 20, 24, 28, 35, 40, 50, 60, 70, 85, 100, 105, 135,
  150, 180, 200, 240, 300, 400, 500, 600, 800,
];

/** Nearest entry in `scale`, measured in log space so stops weigh evenly. */
function snap(value: number, scale: readonly number[]): number {
  let best = scale[0] as number;
  let bestDistance = Infinity;
  const target = Math.log(value);
  for (const candidate of scale) {
    const distance = Math.abs(Math.log(candidate) - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

// ------------------------------------------------------------------ APEX ----

/**
 * Lightroom's catalog stores aperture and shutter as APEX values, and so do a
 * few cameras in `ApertureValue` / `ShutterSpeedValue`. Both are logarithmic:
 * Av = 2·log2(f), Tv = -log2(t).
 */
export function apexToAperture(apex: number): number | null {
  if (!Number.isFinite(apex) || apex < 0 || apex > 20) return null;
  return round(2 ** (apex / 2), 2);
}

export function apexToShutter(apex: number): number | null {
  if (!Number.isFinite(apex) || apex < -12 || apex > 20) return null;
  return 2 ** -apex;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// -------------------------------------------------------------- aperture ----

export function apertureBucket(f: number | null): number | null {
  if (f === null || !Number.isFinite(f) || f <= 0.4 || f > 90) return null;
  return snap(f, APERTURE_STOPS);
}

export function formatAperture(f: number | null): string {
  if (f === null) return "—";
  return `f/${f < 10 ? String(round(f, 1)) : String(Math.round(f))}`;
}

// --------------------------------------------------------------- shutter ----

export function shutterBucket(seconds: number | null): number | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds > 30) return 30; // Bulb and long-exposure work all pile up here.
  return snap(seconds, SHUTTER_STOPS);
}

export function formatShutter(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds >= 1) return `${round(seconds, 1)}s`;
  const denominator = Math.round(1 / seconds);
  return `1/${denominator}`;
}

// ----------------------------------------------------------------- focal ----

export function focalBucket(mm: number | null): number | null {
  if (mm === null || !Number.isFinite(mm) || mm <= 1 || mm > 2000) return null;
  return snap(mm, FOCAL_STOPS);
}

export function formatFocal(mm: number | null): string {
  if (mm === null) return "—";
  return `${mm < 10 ? round(mm, 1) : Math.round(mm)}mm`;
}

export type FocalClass = "ultra-wide" | "wide" | "normal" | "short tele" | "tele" | "super tele";

export const FOCAL_CLASSES: readonly FocalClass[] = [
  "ultra-wide", "wide", "normal", "short tele", "tele", "super tele",
];

/**
 * Angle-of-view families, judged on the 35mm-equivalent focal length when the
 * camera reported one. A 23mm lens on APS-C is a normal lens, not a wide one,
 * and putting it in the wrong family would make every crop-sensor deck lie.
 */
export function focalClass(mm35: number | null): FocalClass | null {
  if (mm35 === null || !Number.isFinite(mm35) || mm35 <= 0) return null;
  if (mm35 <= 20) return "ultra-wide";
  if (mm35 < 35) return "wide";
  if (mm35 < 60) return "normal";
  if (mm35 < 135) return "short tele";
  if (mm35 < 300) return "tele";
  return "super tele";
}

// ------------------------------------------------------------------- ISO ----

export function isoBucket(iso: number | null): number | null {
  if (iso === null || !Number.isFinite(iso) || iso < 12 || iso > 4194304) return null;
  // Full stops from 25 up; anything above 51200 collapses into one bin because
  // the numbers get silly and the count is always tiny.
  const stops = [25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200, 102400];
  return snap(iso, stops);
}

export function formatIso(iso: number | null): string {
  return iso === null ? "—" : `ISO ${Math.round(iso).toLocaleString("en-US")}`;
}

// -------------------------------------------------------------- exposure ----

/**
 * Exposure value at ISO 100 — one number for "how much light was there".
 * EV 15 is bright sun, EV 0 is a dim room, negative is night.
 */
export function exposureValue(
  aperture: number | null,
  shutter: number | null,
  iso: number | null,
): number | null {
  if (!aperture || !shutter || !iso || aperture <= 0 || shutter <= 0 || iso <= 0) return null;
  const ev = Math.log2((aperture * aperture) / shutter) - Math.log2(iso / 100);
  return Number.isFinite(ev) ? round(ev, 1) : null;
}
