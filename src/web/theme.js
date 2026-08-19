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
 *
 * Eight is the whole palette, and therefore the ceiling on how many series a
 * chart may show: a ninth is never an invented hue, it is "Everything else".
 * Both columns pass the validator as a set — worst adjacent CVD ΔE 9.1 light /
 * 8.4 dark, worst normal-vision ΔE 19.6 / 19.3. Three light steps sit under 3:1
 * against the surface, which is why every chart here also has a table view.
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
  series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  /** Sequential blue, near-zero to most. One hue, light to dark. */
  ramp: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf"],
  rampEmpty: "#f0efec",
  /** A day nothing happened on: present, and plainly not the blue. */
  blank: "#dfddd4",
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
  series: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
  // Stepped for the dark surface: the darkest step still reads as "a little",
  // not as the background.
  ramp: ["#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4"],
  rampEmpty: "#232322",
  blank: "#2e2e2b",
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

/**
 * The colour for series `index`, however many there are.
 *
 * The first eight are the validated palette, in slot order, and nothing here
 * disturbs them: their order is what keeps adjacent pairs apart for a
 * colour-blind reader. Past eight the palette has run out, and the choice is
 * between refusing to draw a ninth lens and generating a hue — so hues are
 * generated, deliberately, and as carefully as the documented ones were chosen.
 *
 * Each new colour is picked by search rather than by formula: hues walk the
 * circle by the golden angle, and around each target a handful of hue and
 * lightness candidates are tried and scored on how far they sit from the colour
 * *before* them — measured in OKLab, through normal vision and through
 * simulated protanopia, deuteranopia and tritanopia. The winner is the one that
 * stays furthest from its neighbour in the worst of those four.
 *
 * The honest limit: twenty-five colours cannot all be told apart by hue alone,
 * whoever picks them. This keeps *adjacent* segments separable, which is what a
 * stacked chart needs, and the legend, hover labels and table view carry the
 * identity that colour cannot.
 */
export function seriesColour(index, theme) {
  const slots = theme.series;
  if (index < slots.length) return slots[index];

  const cache = theme.mode === "dark" ? GENERATED_DARK : GENERATED_LIGHT;
  const step = index - slots.length;
  while (cache.length <= step) cache.push(generate(cache.length, theme));
  return cache[step];
}

const GENERATED_LIGHT = [];
const GENERATED_DARK = [];

function generate(step, theme) {
  const dark = theme.mode === "dark";
  // The dark band is narrower: a step that reads on paper disappears against a
  // near-black surface. Both are the bands the documented slots were validated
  // inside, so a generated colour is never lighter or darker than they are.
  const band = dark ? { low: 0.5, high: 0.66 } : { low: 0.46, high: 0.74 };

  // Started well away from the eighth slot (a red at about 25°), then walked by
  // the golden angle, which spreads any number of hues about as evenly as they
  // can be spread.
  const hue = (205 + step * 137.508) % 360;

  const done = dark ? GENERATED_DARK : GENERATED_LIGHT;
  const previous = step === 0 ? theme.series[theme.series.length - 1] : done[step - 1];
  const against = oklabOf(previous);
  // Everything already on the chart, so a new colour is not a near-repeat of
  // one four segments away either — it matters less than the neighbour, and is
  // weighted accordingly.
  const others = [...theme.series, ...done].map((hex) => oklabOf(hex));

  let best = null;
  for (const shift of [0, 12, -12, 24, -24, 36, -36]) {
    for (let L = band.low; L <= band.high + 0.001; L += 0.02) {
      const hex = oklchToHex(L, 0.17, (hue + shift + 360) % 360, 0.1);
      if (!hex) continue;

      // The worst case across normal vision and the three dichromacies: a pair
      // that only separates for some readers has not separated.
      const lab = oklabOf(hex);
      const apart = Math.min(
        deltaE(lab, against),
        ...CVD.map((matrix) => deltaE(oklabOf(hex, matrix), oklabOf(previous, matrix))),
      );
      // A small pull back towards the target hue, so the run keeps walking the
      // circle instead of clustering wherever separation happens to be easiest.
      const nearest = Math.min(...others.map((other) => deltaE(lab, other)));
      const score = apart + nearest * 0.25 - Math.abs(shift) * 0.04;
      if (!best || score > best.score) best = { hex, score };
    }
  }

  return best?.hex ?? "#8a8a8a";
}

/**
 * OKLCH to a hex string, with chroma pulled in until it is inside sRGB.
 *
 * `floor` is the least chroma worth having: below it the colour reads as grey,
 * and this returns null rather than a swatch nobody can name.
 */
function oklchToHex(lightness, chroma, hue, floor) {
  for (let c = chroma; c >= floor; c -= 0.005) {
    const rgb = oklabToRgb(lightness, c * Math.cos((hue * Math.PI) / 180), c * Math.sin((hue * Math.PI) / 180));
    if (rgb.every((v) => v >= -0.001 && v <= 1.001)) {
      return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return null;
}

/** Distance in OKLab, on the same ×100 scale the palette validator reports. */
function deltaE(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;
}

/**
 * Viénot–Brettel–Mollon dichromacy simulations, in linear sRGB.
 *
 * Rows are the three matrices for protanopia, deuteranopia and tritanopia — the
 * standard approximation, and far more than accurate enough to answer "would
 * these two segments look the same?".
 */
const CVD = [
  [0.11238, 0.88762, 0, 0.11238, 0.88762, 0, 0.00401, -0.00401, 1],
  [0.29275, 0.70725, 0, 0.29275, 0.70725, 0, -0.02234, 0.02234, 1],
  [1, 0.14461, -0.14461, 0, 0.85659, 0.14341, 0, 0.85659, 0.14341],
];

/** A hex colour in OKLab, optionally seen through one of the simulations. */
function oklabOf(hex, matrix) {
  const int = parseInt(hex.slice(1), 16);
  let rgb = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });

  if (matrix) {
    rgb = [
      matrix[0] * rgb[0] + matrix[1] * rgb[1] + matrix[2] * rgb[2],
      matrix[3] * rgb[0] + matrix[4] * rgb[1] + matrix[5] * rgb[2],
      matrix[6] * rgb[0] + matrix[7] * rgb[1] + matrix[8] * rgb[2],
    ].map((v) => Math.min(1, Math.max(0, v)));
  }

  const [r, g, b] = rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Björn Ottosson's OKLab, to linear sRGB, to sRGB. */
function oklabToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  return linear.map((v) =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * Math.sign(v) * Math.abs(v) ** (1 / 2.4) - 0.055,
  );
}
