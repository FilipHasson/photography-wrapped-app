// @ts-check
import { hexOf, seriesRun } from "./theme.js";

/**
 * Whole palettes, ready-made.
 *
 * Nobody wants to set twenty-five colours one at a time, and a deck people post
 * is a deck they want to look like theirs rather than like the tool's. So a
 * scheme is a character — a tint for the paper, a hue for the palette to start
 * at, and how loud it is — and everything else is derived from those three.
 *
 * Derived rather than hand-picked, on purpose. Eight hues that stay apart
 * through protanopia *and* deuteranopia are hard to choose by eye; sixteen of
 * them, two modes per scheme, is how palettes end up shipping with a pair that
 * reads as one colour to one man in twelve. `seriesRun` searches for them with
 * the same scoring the generated slots use, so a new scheme is three numbers
 * and cannot quietly be unreadable. `test/palette.test.ts` holds every scheme
 * to the same gates the shipped palette passes.
 *
 * The text is derived too, and that is the part that matters most: the
 * background is the reader's to set, so a scheme that darkens the paper has to
 * lighten the writing on it in the same breath.
 */

/**
 * A scheme's two sides, as role overrides.
 *
 * Light and dark are the same character at different lightnesses rather than
 * inversions of each other — the surface tint keeps its hue, and the writing
 * crosses over.
 */
export const SCHEMES = [
  { id: "default", name: "As it comes", note: "the validated palette" },
  { id: "paper", name: "Paper", note: "warm neutral, red-orange", tint: 85, tone: 0.008, hue: 25, chroma: 0.17 },
  { id: "harbour", name: "Harbour", note: "cool blue-grey", tint: 245, tone: 0.014, hue: 205, chroma: 0.16 },
  { id: "terracotta", name: "Terracotta", note: "warm clay", tint: 50, tone: 0.02, hue: 15, chroma: 0.19 },
  { id: "moss", name: "Moss", note: "green, quieter", tint: 150, tone: 0.014, hue: 155, chroma: 0.13 },
  { id: "orchid", name: "Orchid", note: "violet, louder", tint: 305, tone: 0.016, hue: 290, chroma: 0.21 },
];

/**
 * How far each derived neutral sits from the paper, in lightness.
 *
 * One table for both modes, signed away from the surface: on light paper every
 * step goes down, on dark paper every step goes up. Writing them as distances
 * rather than as two lists is what keeps a scheme's dark side recognisably the
 * same scheme.
 */
const STEPS = {
  plane: 0.025,
  track: 0.05,
  grid: 0.08,
  blank: 0.11,
  axis: 0.2,
};

/** Absolute lightnesses for the writing, which crosses over between modes. */
const TEXT = {
  light: { ink: 0.16, ink2: 0.38, muted: 0.55 },
  dark: { ink: 0.97, ink2: 0.82, muted: 0.63 },
};

/** How light the paper itself is. Not white and not black: both are harsh. */
const PAPER = { light: 0.975, dark: 0.19 };

function side(scheme, mode) {
  const dark = mode === "dark";
  const away = dark ? 1 : -1;
  const paper = PAPER[mode];
  const tone = scheme.tone;

  /** A neutral at a distance from the paper, keeping the paper's own tint. */
  const step = (by) => hexOf(paper + away * by, tone, scheme.tint);
  const text = TEXT[mode];

  const background = hexOf(paper, tone, scheme.tint);
  const series = seriesRun(scheme.hue, mode, scheme.chroma, background);
  const roles = {
    surface: background,
    ink: hexOf(text.ink, tone * 0.5, scheme.tint),
    ink2: hexOf(text.ink2, tone * 0.7, scheme.tint),
    muted: hexOf(text.muted, tone * 0.7, scheme.tint),
    plane: step(STEPS.plane),
    track: step(STEPS.track),
    grid: step(STEPS.grid),
    blank: step(STEPS.blank),
    axis: step(STEPS.axis),
    // "Nothing here" reads as the paper with a shadow on it, one step short of
    // the squares that mean a day nobody shot.
    rampEmpty: step(STEPS.track),
    // The clock's two poles are heat, not identity: cool for the small hours,
    // warm for the middle of the day, whatever hue the scheme starts at.
    night: hexOf(dark ? 0.6 : 0.52, scheme.chroma, 250),
    day: hexOf(dark ? 0.72 : 0.68, scheme.chroma, 75),
  };

  series.forEach((hex, i) => (roles[`series.${i}`] = hex));
  // One hue, climbing — down the page on light paper, up it on dark, because
  // "more" has to read as further from the background either way.
  ramp(scheme.hue, dark).forEach((hex, i) => (roles[`ramp.${i}`] = hex));

  return roles;
}

/** Five steps of one hue, far enough apart that the calendar is not flat. */
function ramp(hue, dark) {
  const from = dark ? 0.42 : 0.88;
  const to = dark ? 0.82 : 0.5;
  return Array.from({ length: 5 }, (_, i) => hexOf(from + ((to - from) * i) / 4, 0.13, hue));
}

/**
 * The palette a scheme stands for, both sides at once.
 *
 * "As it comes" is an empty override rather than a copy of today's defaults:
 * storing the built-in palette would freeze this version of it into a config
 * and stop that reader ever getting an improvement to it.
 */
export function schemePalette(id) {
  const scheme = SCHEMES.find((entry) => entry.id === id);
  if (!scheme || scheme.hue === undefined) return { light: {}, dark: {} };
  return { light: side(scheme, "light"), dark: side(scheme, "dark") };
}
