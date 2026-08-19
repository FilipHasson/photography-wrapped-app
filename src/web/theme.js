// @ts-check
/**
 * Colour, as data rather than CSS.
 *
 * Slides are drawn as SVG and then rasterised for export, and a rasterised SVG
 * is rendered in isolation — no page, no stylesheet, no custom properties. So
 * every colour a slide uses is passed in explicitly from here, and the same
 * object drives the live page and the exported PNG or PDF.
 *
 * The values are the validated categorical palette: the light and dark columns
 * are the same eight hues stepped for their own surface, and their *order* is
 * the colour-blind-safety mechanism, so they are assigned by slot and never
 * cycled or re-ordered.
 */

const SHARED = {
  font: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

export const LIGHT = {
  ...SHARED,
  mode: "light",
  surface: "#fcfcfb",
  plane: "#f9f9f7",
  ink: "#0b0b0b",
  ink2: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  track: "#f0efec",
  series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"],
  /** Sequential blue, near-zero to most. One hue, light to dark. */
  ramp: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf"],
  rampEmpty: "#f0efec",
  // Two poles for the clock: cool for the small hours, warm for the middle of
  // the day. Semantic heat rather than categories — the thing being encoded
  // really is how much light there was — so it ships with a scale legend.
  night: "#1c5cab",
  day: "#eda100",
};

export const DARK = {
  ...SHARED,
  mode: "dark",
  surface: "#1a1a19",
  plane: "#0d0d0d",
  ink: "#ffffff",
  ink2: "#c3c2b7",
  muted: "#898781",
  grid: "#2c2c2a",
  axis: "#383835",
  track: "#262624",
  series: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"],
  // Stepped for the dark surface: the darkest step still reads as "a little",
  // not as the background.
  ramp: ["#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4"],
  rampEmpty: "#232322",
  night: "#3987e5",
  day: "#c98500",
};

/** Follows the toggle when one is set, and the OS otherwise. */
export function currentTheme() {
  const attribute = document.documentElement.dataset.theme;
  if (attribute === "dark") return DARK;
  if (attribute === "light") return LIGHT;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? DARK : LIGHT;
}
