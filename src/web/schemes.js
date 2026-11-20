// @ts-check
import { fitToPaper, hexOf, separated, seriesRun } from "./theme.js";

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
  // Fitted to the paper, every one of them. `seriesRun` scores a candidate on
  // how far it sits from its *neighbour*, which is what keeps a chart readable
  // through colour blindness and says nothing at all about whether the colour
  // can be seen against the sheet it is drawn on. Both matter, and only one of
  // them was being checked.
  const series = seriesRun(scheme.hue, mode, scheme.chroma, background, 8, scheme.seed ?? null).map(
    (hex) => fitToPaper(hex, background),
  );
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

    /**
     * The four that carry a job rather than a slot.
     *
     * A scheme has to answer for these or it half-applies: leave them out and
     * Terracotta repaints seven slides and leaves a mint "Picked" sitting on
     * culling. Two follow the run, because a keeper and a weekend are identity
     * — they are *this* palette's first and second colours. The other two do
     * not: a rejected frame is red and a silence is amber because that is what
     * those things look like, not because of where a hue landed in the search.
     * Both are fitted to the scheme's own paper, so a dark scheme gets a red
     * that can be seen on it.
     */
    pick: series[0],
    weekend: series[1],
    reject: negativeFor(series[0], background, dark),
    quiet: fitToPaper(hexOf(dark ? 0.68 : 0.62, 0.14, 62), background),
  };

  series.forEach((hex, i) => (roles[`series.${i}`] = hex));
  // One hue, climbing — down the page on light paper, up it on dark, because
  // "more" has to read as further from the background either way.
  ramp(scheme.hue, dark).forEach((hex, i) => (roles[`ramp.${i}`] = hex));

  return roles;
}

/**
 * The colour a rejection is drawn in: red, unless red will not do.
 *
 * Rejection is red — not a preference, it is what the colour means. But Picked
 * and Rejected sit side by side on one slide, at the same size, meaning
 * opposite things, and two of the ways a scheme can go wrong are not obvious
 * until you look for them. A warm scheme's primary *is* red, so the pair
 * becomes the same card twice; and a **green** primary against a red negative
 * is the single most common pair a colour-blind reader cannot separate at all —
 * which is not hypothetical here, since the shipped primary is a green.
 *
 * So it is searched rather than assumed, in order of how much each candidate
 * still reads as a rejection, and the first one that clears both floors against
 * the primary wins. Darkening comes before changing hue, because a dark red is
 * still plainly a red and lightness is the channel colour blindness leaves
 * alone. `paletteProblems` gates the pair afterwards regardless, so a scheme
 * that somehow gets past all of this still says so out loud.
 */
const NEGATIVES = [
  { hue: 27, chroma: 0.19, by: 0 },
  { hue: 27, chroma: 0.16, by: -0.13 },
  { hue: 12, chroma: 0.19, by: -0.06 },
  { hue: 355, chroma: 0.19, by: 0 },
  { hue: 340, chroma: 0.2, by: 0 },
  { hue: 320, chroma: 0.2, by: 0 },
];

function negativeFor(pick, background, dark) {
  const base = dark ? 0.64 : 0.58;
  let fallback = null;

  for (const one of NEGATIVES) {
    const hex = fitToPaper(hexOf(base + one.by, one.chroma, one.hue), background);
    fallback ??= hex;
    if (separated(pick, hex)) return hex;
  }
  // Nothing red-ish worked, which means the primary is itself a red or a
  // near-red: take the far side of the circle, the other honest reading of
  // "opposite".
  return fallback;
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
