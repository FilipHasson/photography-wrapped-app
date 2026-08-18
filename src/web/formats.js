// @ts-check
/**
 * The shapes a slide can be.
 *
 * A deck that only exists on a laptop can be 16:9 forever; a deck that goes to
 * Instagram cannot. Every format here is a real posting size, and each carries
 * its own type scale rather than scaling one design down — a headline that
 * works across 1600px of laptop is unreadable at thumbnail size on a phone, so
 * the narrow formats set type *larger* relative to their width, not smaller.
 *
 * `headlineLines` matters for the same reason: a 45-character headline is two
 * lines wide and four lines narrow, and the space below it has to be budgeted
 * for whichever it turns out to be.
 */

export const FORMATS = [
  {
    id: "landscape",
    label: "16:9",
    note: "Slides, screens, PDF",
    width: 1600,
    height: 900,
    pad: 96,
    typeScale: 1,
    headlineLines: 2,
  },
  {
    id: "story",
    label: "9:16",
    note: "Stories and Reels",
    width: 1080,
    height: 1920,
    pad: 88,
    typeScale: 0.95,
    headlineLines: 4,
  },
  {
    id: "portrait",
    label: "4:5",
    note: "Feed post — the tallest the grid allows",
    width: 1080,
    height: 1350,
    pad: 84,
    typeScale: 0.9,
    headlineLines: 3,
  },
  {
    id: "grid",
    label: "4:3",
    note: "Grid post",
    width: 1440,
    height: 1080,
    pad: 88,
    typeScale: 0.95,
    headlineLines: 3,
  },
  {
    id: "square",
    label: "1:1",
    note: "Square",
    width: 1080,
    height: 1080,
    pad: 80,
    typeScale: 0.88,
    headlineLines: 3,
  },
];

export const DEFAULT_FORMAT = FORMATS[0];

export function formatById(id) {
  return FORMATS.find((format) => format.id === id) ?? DEFAULT_FORMAT;
}

/**
 * Type sizes and the space they need, for one format.
 *
 * Everything a slide draws is measured off this, so a format is a set of
 * numbers rather than a set of special cases in the drawing code. `narrow` is
 * the one shape question the charts ask: below about 1200px a horizontal bar
 * cannot carry a lens name *and* a bar *and* a number on one line, so those
 * slides stack instead.
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
    note: size(20),
    noteLines: format.height > 1200 ? 4 : 3,
    headlineLines: format.headlineLines,

    label: size(24),
    value: size(22),
    axis: size(18),
    tiny: size(16),

    tileLabel: size(17),
    tileValue: size(46),
    hero: size(200),
  };
}
