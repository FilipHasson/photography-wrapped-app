// @ts-check
/**
 * The lettering a deck is set in.
 *
 * **No webfonts, and that is not a limitation to work around.** Nothing here
 * ever makes a request, so the only faces available are the ones already on the
 * machine — and a stack that names a face the reader does not have falls back
 * silently, which is worse than not offering it: the deck would look like the
 * tool's default while claiming to be something else. So every stack below ends
 * in a generic family, and every named face in it ships with Windows *and*
 * macOS. Four that actually look different from one another beats twelve that
 * mostly resolve to the same grotesque.
 *
 * It matters more here than on a normal page. A slide is rasterised through an
 * `<img>` for the PNG and the PDF, which renders in isolation with no page
 * around it — the font is written on the `<svg>` as an attribute for exactly
 * that reason, and a face that only exists because the *page* loaded it would
 * vanish from the export without a word.
 */
export const FONTS = [
  {
    id: "system",
    label: "System",
    note: "what the rest of the app is set in",
    stack: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  {
    id: "serif",
    label: "Serif",
    note: "Georgia — quieter, and older",
    stack: 'Georgia, "Iowan Old Style", "Times New Roman", Times, serif',
  },
  {
    id: "condensed",
    label: "Condensed",
    note: "narrow, so a long name fits",
    stack: '"Arial Narrow", "Avenir Next Condensed", "Roboto Condensed", "Liberation Sans Narrow", sans-serif',
  },
  {
    id: "mono",
    label: "Mono",
    note: "figures line up under each other",
    stack: 'ui-monospace, "Cascadia Mono", Consolas, "SF Mono", Menlo, "DejaVu Sans Mono", monospace',
  },
];

export const fontById = (id) => FONTS.find((one) => one.id === id) ?? FONTS[0];

/**
 * How much bigger or smaller than the format's own scale, and how the headline
 * is set.
 *
 * Size is **one multiplier over the whole deck** rather than a number per
 * piece of text. Every size on a slide is derived from the format's type scale
 * — the headline steps down when it is long, the calendar's day labels come off
 * the square size, a list buys its rows out of the type — so a single factor
 * moves all of it together and keeps the proportions the layouts were tuned
 * for. Letting a reader set the headline to 90px and the axis to 40px would let
 * them build a slide the renderer has no way to fit.
 *
 * Weight and slant are the headline's alone, on purpose. It is the one piece of
 * text on a slide that is a design choice rather than a measurement: an eyebrow
 * in italics is a mistake, an axis label at weight 800 is noise, and a headline
 * is the line somebody actually wants to style.
 */
export const SCALES = [
  { id: 0.85, label: "S" },
  { id: 1, label: "M" },
  { id: 1.12, label: "L" },
  { id: 1.25, label: "XL" },
];

export const WEIGHTS = [
  { id: 400, label: "Regular" },
  { id: 600, label: "Semibold" },
  { id: 800, label: "Bold" },
];
