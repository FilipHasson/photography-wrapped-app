// @ts-check
/**
 * The shapes a slide can be.
 *
 * A deck that only lives on a laptop can be 16:9 forever; a deck that goes to
 * Instagram cannot, and **9:16 is the one that matters** — it is the default,
 * and the layouts are tuned for it rather than tolerating it.
 *
 * Two numbers per format do most of the work:
 *
 * `typeScale` is measured against a 1600px-wide design, and it goes *up* as the
 * frame gets narrower. A 20px label is comfortable across 1600px of laptop; the
 * same label on a 1080px frame viewed full-screen on a phone is a third of the
 * apparent size, which is how a slide ends up unreadable in the one place it
 * was made for.
 *
 * `headlineLines` budgets the space below the headline. A 45-character headline
 * is two lines wide and four lines narrow, and the chart underneath has to be
 * laid out for whichever it turns out to be.
 */

export const FORMATS = [
  {
    id: "story",
    label: "9:16",
    note: "Stories and Reels — the default",
    width: 1080,
    height: 1920,
    pad: 80,
    typeScale: 1.3,
    headlineLines: 4,
  },
  {
    id: "portrait",
    label: "4:5",
    note: "Feed post — the tallest the grid allows",
    width: 1080,
    height: 1350,
    pad: 76,
    typeScale: 1.2,
    headlineLines: 3,
  },
  {
    id: "square",
    label: "1:1",
    note: "Square",
    width: 1080,
    height: 1080,
    pad: 72,
    typeScale: 1.12,
    headlineLines: 3,
  },
  {
    id: "grid",
    label: "4:3",
    note: "Grid post",
    width: 1440,
    height: 1080,
    pad: 88,
    typeScale: 1.05,
    headlineLines: 3,
  },
  {
    id: "landscape",
    label: "16:9",
    note: "Screens, projectors, the PDF",
    width: 1600,
    height: 900,
    pad: 96,
    typeScale: 1,
    headlineLines: 2,
  },
];

export const DEFAULT_FORMAT = FORMATS[0];

export function formatById(id) {
  return FORMATS.find((format) => format.id === id) ?? DEFAULT_FORMAT;
}

/**
 * Type sizes and the space they need, for one format.
 *
 * Everything a slide draws is measured off this, so supporting a new shape is a
 * row in the table above rather than a special case in the drawing code.
 *
 * `narrow` is the one shape question the charts ask: below about 1200px a
 * horizontal bar cannot carry a lens name *and* a bar *and* a number on one
 * line, so those slides stack instead. `tall` decides which way a calendar
 * runs and how much a chart is allowed to grow into the space it is given.
 */
export function metrics(format) {
  const s = format.typeScale;
  const size = (base) => Math.round(base * s);

  return {
    width: format.width,
    height: format.height,
    pad: format.pad,
    narrow: format.width < 1200,
    tall: format.height > format.width * 1.2,

    eyebrow: size(20),
    headline: size(62),
    headlineSmall: size(48),
    subtitle: size(26),
    note: size(19),
    noteLines: format.height > 1200 ? 4 : 3,
    headlineLines: format.headlineLines,

    label: size(24),
    value: size(22),
    axis: size(18),
    tiny: size(16),

    tileLabel: size(17),
    tileValue: size(46),
    // A tall frame is mostly empty unless the figures grow into it: a hero
    // number set for a 16:9 slide is a caption on a story.
    hero: Math.round(size(200) * (format.height > format.width ? 1.6 : 1)),
  };
}
