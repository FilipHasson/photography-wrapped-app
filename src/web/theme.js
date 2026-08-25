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
 * The run starts from a colour somebody chose — `#0fce92` — and is *derived*
 * from it rather than picked alongside it: `seriesRun` walks the hue circle by
 * the golden angle from there, scoring each candidate on how far it sits from
 * its neighbour through normal vision and three kinds of colour blindness, and
 * every result is then `fitToPaper`'d so nothing lands too faint to see. Dark
 * carries the chosen colour exactly. Light cannot — at L 0.75 against near-white
 * paper it is 2.0:1, under the 3:1 a mark has to clear — so light takes the same
 * hue and chroma stepped down until it does, which is the whole reason this
 * object has two columns rather than one and a filter.
 *
 * A slot is a *series*, and nothing else. Four jobs used to borrow one — Picked
 * and the working week rode on `series.0`, the weekend on `series.1`, and both
 * Rejected and the longest silence on `series.7` — which meant a reader who
 * moved the eighth series repainted a verdict on one slide and a wall of days on
 * another, and could not touch either without the other. They are roles of their
 * own now (`pick`, `reject`, `quiet`, `weekend`), which also let the two
 * negatives stop being whatever hue slot seven happened to hold: a rejected
 * frame is red because that is what a rejection looks like, not because it was
 * eighth in a list.
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
  series: ["#12a676", "#763496", "#e46e3b", "#0359a0", "#bf75d9", "#086b0b", "#0f9bd1", "#8e3c07"],
  /** Sequential, near-zero to most. The accent's own hue, light to dark. */
  ramp: ["#7df2bf", "#5cd3a1", "#38b484", "#0f9569", "#0a7552"],
  rampEmpty: "#f0efec",
  /** A day nothing happened on: present, and plainly not the accent. */
  blank: "#dfddd4",
  pick: "#12a676",
  reject: "#d33b36",
  quiet: "#c06f0a",
  weekend: "#763496",
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
  series: ["#0fce92", "#7d50b9", "#e16b38", "#3b95f0", "#b63c2f", "#9d9704", "#425fc4", "#d7750c"],
  // Stepped for the dark surface: the darkest step still reads as "a little",
  // not as the background.
  ramp: ["#015c3f", "#087c57", "#129e70", "#44be8d", "#68deac"],
  rampEmpty: "#232322",
  blank: "#2e2e2b",
  pick: "#0fce92",
  reject: "#e95048",
  quiet: "#d4822b",
  weekend: "#7d50b9",
  night: "#3987e5",
  day: "#c98500",
};

/** Which of the two columns is in front of the reader right now. */
export function currentMode() {
  const attribute = document.documentElement.dataset.theme;
  if (attribute === "dark") return "dark";
  if (attribute === "light") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * The built-in palette for a mode, with the reader's own colours over the top.
 *
 * The override is sparse — a role nobody has touched is simply absent — so this
 * is the only place that knows how `series.3` becomes `theme.series[3]`, and a
 * config saved a year ago still picks up every improvement to the roles it
 * never had an opinion about.
 */
export function themeFor(mode, override) {
  const base = mode === "dark" ? DARK : LIGHT;
  const entries = Object.entries(override ?? {});
  if (entries.length === 0) return base;

  const theme = { ...base, series: [...base.series], ramp: [...base.ramp] };

  for (const [id, hex] of entries) {
    // Split rather than matched. A role id is "series.3" or "blank", and a
    // pattern here is one lost escape away from silently matching nothing.
    const dot = id.indexOf(".");
    if (dot < 0) {
      if (id in theme) theme[id] = hex;
      continue;
    }

    const list = theme[id.slice(0, dot)];
    const at = Number(id.slice(dot + 1));
    if (Array.isArray(list) && Number.isInteger(at) && at >= 0 && at < list.length) list[at] = hex;
  }

  return theme;
}

/**
 * Follows the toggle when one is set, and the OS otherwise.
 *
 * The backdrop rides along here rather than being a fourth argument to
 * `renderSlide`: everything a drawing needs that is not the slide already
 * travels in this object, and the export path, the contact sheet and the live
 * page all build their theme through this one call. A flat backdrop is left off
 * entirely so the built-in palette objects are still handed back untouched.
 */
export function currentTheme(palette, backdrop, cardStyle) {
  const mode = currentMode();
  const theme = themeFor(mode, palette?.[mode]);
  const drawn = backdrop && backdrop.kind && backdrop.kind !== "flat" ? { ...theme, backdrop } : theme;
  // Both ride on the theme rather than as extra arguments to `renderSlide`,
  // because everything a drawing needs that is not the slide already travels
  // there — and the page, the contact sheet and every export build their theme
  // through this one call.
  return cardStyle ? { ...drawn, cardStyle } : drawn;
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

  const cache = cacheFor(theme);
  const step = index - slots.length;
  while (cache.length <= step) cache.push(generate(cache.length, theme, cache));
  return cache[step];
}

/**
 * Generated colours, keyed on the palette that produced them.
 *
 * They are searched for rather than computed — each one is scored against the
 * eight documented slots and against the generated colours before it — so a
 * cache keyed on the mode alone would hand a ninth lens the colour it was given
 * against somebody else's palette. It was keyed on nothing at all until the
 * palette could move, at which point it became a real bug rather than a
 * latent one.
 */
const GENERATED = new Map();

function cacheFor(theme) {
  const key = `${theme.mode}:${theme.series.join(",")}`;
  let cache = GENERATED.get(key);
  if (!cache) {
    cache = [];
    GENERATED.set(key, cache);
  }
  return cache;
}

/**
 * The lightness a series colour is allowed to live in.
 *
 * The dark band is narrower: a step that reads on paper disappears against a
 * near-black surface. Both are the bands the documented slots were validated
 * inside, so a generated colour is never lighter or darker than they are.
 */
const BAND = {
  light: { low: 0.46, high: 0.74 },
  dark: { low: 0.5, high: 0.66 },
};

/** The golden angle: the one step that spreads any number of hues evenly. */
const TURN = 137.508;

/**
 * The best colour near a target hue, given what is already on the chart.
 *
 * Scored on how far it sits from the colour *before* it — in OKLab, through
 * normal vision and through simulated protanopia, deuteranopia and tritanopia —
 * with a small pull back towards the target hue so a run keeps walking the
 * circle instead of clustering wherever separation happens to be easiest.
 */
function pick(hue, band, chroma, previous, others, shifts = [0, 12, -12, 24, -24, 36, -36]) {
  const against = oklabOf(previous);
  let best = null;

  for (const shift of shifts) {
    for (let L = band.low; L <= band.high + 0.001; L += 0.02) {
      const hex = oklchToHex(L, chroma, (hue + shift + 360) % 360, 0.1);
      if (!hex) continue;

      // The worst case across normal vision and the three dichromacies: a pair
      // that only separates for some readers has not separated.
      const lab = oklabOf(hex);
      const apart = Math.min(
        deltaE(lab, against),
        ...CVD.map((matrix) => deltaE(oklabOf(hex, matrix), oklabOf(previous, matrix))),
      );
      const nearest = others.length === 0 ? 0 : Math.min(...others.map((other) => deltaE(lab, other)));
      const score = apart + nearest * 0.25 - Math.abs(shift) * 0.04;
      if (!best || score > best.score) best = { hex, score };
    }
  }

  return best?.hex ?? "#8a8a8a";
}

function generate(step, theme, done) {
  // Started well away from the eighth slot (a red at about 25°).
  const hue = (205 + step * TURN) % 360;
  const previous = step === 0 ? theme.series[theme.series.length - 1] : done[step - 1];
  // Everything already on the chart, so a new colour is not a near-repeat of
  // one four segments away either — it matters less than the neighbour, and is
  // weighted accordingly.
  const others = [...theme.series, ...done].map((hex) => oklabOf(hex));

  return pick(hue, BAND[theme.mode === "dark" ? "dark" : "light"], 0.17, previous, others);
}

/**
 * A whole run of series colours from one starting hue.
 *
 * The same search the ninth lens gets, seeded rather than fixed, so a scheme
 * can say where its palette begins and still be one nobody has to squint at:
 * every adjacent pair is chosen to survive three kinds of colour blindness.
 * Hand-picking eight hues that do that, twice per scheme, is how palettes end
 * up shipping with a pair that reads as one.
 */
/**
 * A colour the reader chose, moved only as far as the paper forces.
 *
 * Their hex first, unchanged, whenever it already clears the floor — which on
 * a dark deck is usually the answer, and is the whole point: a colour somebody
 * picked should come back as the colour they picked. Where it does not clear,
 * lightness walks *away* from the paper a step at a time and stops at the first
 * position that does. Hue and chroma never move, so what comes back is the same
 * colour seen against a different sheet rather than a different colour.
 *
 * This exists because `pick` is the wrong tool for a named seed. It searches for
 * whatever sits furthest from the paper, which is right when nobody has said
 * what they want and wrong the moment somebody has: a mint green asked for at
 * L 0.75 came back a forest green at L 0.47, which is not a step of the same
 * colour, it is another one.
 */
export function fitToPaper(hex, paper, floor = CONTRAST_MIN) {
  if (contrast(hex, paper) >= floor) return hex;

  const { l, c, h } = oklchOf(hex);
  // Away from the paper: down on a light sheet, up on a dark one.
  const away = oklchOf(paper).l > 0.5 ? -1 : 1;

  for (let step = 1; step <= 60; step++) {
    const moved = hexOf(Math.min(1, Math.max(0, l + away * step * 0.01)), c, h);
    if (contrast(moved, paper) >= floor) return moved;
  }
  // Nothing on this hue clears it. The reader's own colour is a better answer
  // than a grey, and `paletteProblems` will say so out loud.
  return hex;
}

export function seriesRun(startHue, mode, chroma = 0.17, against = null, count = 8, seed = null) {
  const band = BAND[mode === "dark" ? "dark" : "light"];
  // The first colour is chosen away from the *paper*, which is the one thing
  // every slide draws it on. Picking it by formula instead put a scheme's whole
  // run behind a grey: a hue that cannot hold the asked-for chroma at the middle
  // of the band has no colour there at all, and everything after it was then
  // scored against that grey.
  const paper = against ?? (mode === "dark" ? DARK : LIGHT).surface;
  // The seed keeps its hue exactly — no drift is allowed on the one colour that
  // says what the scheme is. A shift of thirty degrees is nothing on the fifth
  // series and the difference between a violet deck and a blue one here.
  // A named seed is used as given, fitted to the paper and no further. Only a
  // run with nothing but a hue behind it goes looking.
  const run = [seed ? fitToPaper(seed, paper) : pick(startHue % 360, band, chroma, paper, [], [0])];

  while (run.length < count) {
    const hue = (startHue + run.length * TURN) % 360;
    run.push(pick(hue, band, chroma, run[run.length - 1], run.map((hex) => oklabOf(hex))));
  }
  return run;
}

/**
 * What is wrong with a palette, in the reader's words.
 *
 * Colour-blind safety is a property of the *set*, never of any colour in it:
 * two of the eight sitting within ΔE 8 of each other through simulated
 * protanopia is a chart that lies to about one man in twelve, and no amount of
 * staring at either swatch would tell you. So the same gates the generator
 * scores against are run over whatever the reader has built.
 *
 * Warnings, not refusals. It is their deck, and a palette that fails a gate is
 * usually a deliberate choice about a chart they know only they will read. But
 * it says plainly which pair, so the choice is an informed one.
 */
export function paletteProblems(theme) {
  const problems = [];
  const series = theme.series;

  /**
   * Adjacent pairs only, and only protanopia and deuteranopia.
   *
   * Both of those are the validator's, not a simplification of it. Slot order
   * is the safety mechanism — a chart of three series uses slots 1, 2 and 3 —
   * so 1-against-5 matters far less than 1-against-2, and flagging every pair
   * would bury the ones that count. Tritanopia is measured and reported by the
   * validator rather than gated on, because it is vanishingly rare and gating
   * on it fails palettes that are fine: the shipped one trips it at ΔE 5.6.
   */
  for (let i = 0; i + 1 < series.length; i++) {
    const cvd = Math.min(
      deltaE(oklabOf(series[i], MACHADO.protan), oklabOf(series[i + 1], MACHADO.protan)),
      deltaE(oklabOf(series[i], MACHADO.deutan), oklabOf(series[i + 1], MACHADO.deutan)),
    );
    if (cvd < CVD_FLOOR) {
      problems.push({
        role: `series.${i}`,
        severity: "warn",
        text: `Series ${i + 1} and ${i + 2} look the same to a colour-blind reader (ΔE ${cvd.toFixed(1)}, needs ${CVD_FLOOR}).`,
      });
    }

    // The other half of the same question, and a harder gate: the pair has to
    // be separable for everyone else too, and no legend or label excuses it.
    const normal = deltaE(oklabOf(series[i]), oklabOf(series[i + 1]));
    if (normal < NORMAL_FLOOR) {
      problems.push({
        role: `series.${i}`,
        severity: "warn",
        text: `Series ${i + 1} and ${i + 2} are hard to tell apart at all (ΔE ${normal.toFixed(1)}, needs ${NORMAL_FLOOR}).`,
      });
    }
  }

  /**
   * The two verdicts, which are drawn side by side on one slide.
   *
   * The series gates walk *adjacent* slots, and these two are not slots at all
   * any more — so nothing was checking the one pair in the whole palette a
   * reader is guaranteed to see together, at the same size, meaning opposite
   * things. A scheme whose primary is already red is how that happens: Picked
   * follows the run, Rejected is red because rejection is red, and on a warm
   * scheme they quietly became the same card twice.
   */
  const picked = colourAt(theme, "pick");
  const rejected = colourAt(theme, "reject");
  if (picked && rejected) {
    const { cvd, normal } = separation(picked, rejected);
    if (cvd < CVD_FLOOR) {
      problems.push({
        role: "reject",
        severity: "warn",
        text: `Picked and Rejected look the same to a colour-blind reader (ΔE ${cvd.toFixed(1)}, needs ${CVD_FLOOR}).`,
      });
    }
    if (normal < NORMAL_FLOOR) {
      problems.push({
        role: "reject",
        severity: "warn",
        text: `Picked and Rejected are hard to tell apart at all (ΔE ${normal.toFixed(1)}, needs ${NORMAL_FLOOR}).`,
      });
    }
  }

  /**
   * A heat ramp has to climb, and climb one way.
   *
   * Lightness rather than hue, because lightness is what "more" reads as and
   * the only part that survives being printed. Two failures, and the second is
   * the one nobody expects: a ramp that brightens, dips and brightens again
   * gives two different quantities the same square, and the calendar becomes
   * unreadable without anything looking obviously wrong.
   */
  const steps = theme.ramp
    .slice(1)
    .map((hex, i) => oklabOf(hex)[0] - oklabOf(theme.ramp[i])[0]);

  steps.forEach((step, i) => {
    if (Math.abs(step) >= RAMP_STEP) return;
    problems.push({
      role: `ramp.${i + 1}`,
      severity: "warn",
      text: `Heat ${i + 1} and ${i + 2} are the same brightness — the calendar will read as flat.`,
    });
  });

  const up = steps.filter((step) => step > 0).length;
  if (up > 0 && up < steps.length) {
    problems.push({
      role: "ramp.0",
      severity: "warn",
      text: "The heat ramp changes direction — two different amounts will be drawn the same shade.",
    });
  }

  /**
   * Contrast against the surface these are actually drawn on.
   *
   * A note rather than a warning, because the shipped palette does not clear it
   * either: three of the light steps sit under 3:1, which is one of the reasons
   * every chart here also has a table view. Worth saying, not worth shouting.
   *
   * `blank` and `rampEmpty` are left out on purpose — they *mean* "nothing
   * here", so measuring them against the background is asking the wrong
   * question, and `grid` and `axis` are hairlines that are meant to recede.
   */
  // The four that carry a job of their own are measured too. They are marks on
  // a slide like any series is, and being named after what they mean rather
  // than after a slot number is no reason to stop checking whether they can be
  // seen.
  for (const role of [
    ...series.map((_, i) => `series.${i}`),
    "pick",
    "reject",
    "quiet",
    "weekend",
    "night",
    "day",
  ]) {
    const hex = colourAt(theme, role);
    if (!hex) continue;

    const ratio = contrast(hex, theme.surface);
    if (ratio >= CONTRAST_MIN) continue;
    problems.push({
      role,
      severity: "note",
      text: `${ratio.toFixed(1)}:1 against the ${theme.mode} background — faint, and reachable only in the table.`,
    });
  }

  /**
   * Text against the background, and this one shouts.
   *
   * The background is the reader's to set, which is why it can be set to the
   * colour of the writing on it. A faint *series* is recoverable — the table
   * carries every value a chart does, which is the whole reason that view
   * exists — but a headline nobody can read is a slide with nothing on it, and
   * no table anywhere fixes that. So these are warnings rather than notes, and
   * they are measured at the WCAG ratios for text rather than at the mark
   * floor: 4.5 for the big type, 3 for what supports it.
   */
  for (const [role, floor, what] of [
    ["ink", TEXT_MIN, "The headline"],
    ["ink2", CONTRAST_MIN, "Body text"],
    ["muted", CONTRAST_MIN, "The quiet text"],
  ]) {
    const hex = colourAt(theme, role);
    if (!hex) continue;

    const ratio = contrast(hex, theme.surface);
    if (ratio >= floor) continue;
    problems.push({
      role,
      severity: "warn",
      text: `${what} is ${ratio.toFixed(1)}:1 against the background — needs ${floor}, and nothing else on the slide says it.`,
    });
  }

  return problems;
}

// The validator's numbers, and its reasons. ΔE is OKLab distance ×100.
const CVD_FLOOR = 6;
const NORMAL_FLOOR = 15;
/**
 * How far apart two colours are, in the two ways that matter.
 *
 * `cvd` is the worst of protanopia and deuteranopia, which is the number a
 * chart's readability for about one man in twelve rests on; `normal` is the
 * plain OKLab distance, which no legend excuses. Exported because three
 * different places need to ask it — the gates here, and `schemes.js`, which has
 * to *search* for a colour that passes rather than assume one does.
 */
export function separation(a, b) {
  return {
    cvd: Math.min(
      deltaE(oklabOf(a, MACHADO.protan), oklabOf(b, MACHADO.protan)),
      deltaE(oklabOf(a, MACHADO.deutan), oklabOf(b, MACHADO.deutan)),
    ),
    normal: deltaE(oklabOf(a), oklabOf(b)),
  };
}

/** True when a pair clears both floors — the question `separation` is asked for. */
export function separated(a, b) {
  const { cvd, normal } = separation(a, b);
  return cvd >= CVD_FLOOR && normal >= NORMAL_FLOOR;
}

const CONTRAST_MIN = 3;
/** Text carries meaning nothing else on the slide repeats, so it is held higher. */
const TEXT_MIN = 4.5;
const RAMP_STEP = 0.06;

/** The role's current colour, whether it lives in a list or on its own. */
export function colourAt(theme, role) {
  const dot = role.indexOf(".");
  if (dot < 0) return typeof theme[role] === "string" ? theme[role] : null;

  const list = theme[role.slice(0, dot)];
  return Array.isArray(list) ? (list[Number(role.slice(dot + 1))] ?? null) : null;
}

/** WCAG relative luminance contrast, which is what a 3:1 floor is written in. */
function contrast(a, b) {
  const luminance = (hex) => {
    const int = parseInt(hex.slice(1), 16);
    const [r, g, bl] = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };

  const one = luminance(a);
  const two = luminance(b);
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
}

/**
 * Machado, Oliveira & Fernandes (2009) at severity 1.0, in linear sRGB.
 *
 * A second set of matrices beside `CVD`, and not a duplicate of it. The
 * thresholds above are the palette validator's, and the validator calibrated
 * them against *these* — swapping in the Viénot approximation the generator
 * uses moves borderline pairs and would quietly change what passes. The
 * generator's own scoring is relative and self-consistent, so it keeps the
 * matrices it was tuned with; a gate that has to agree with a published
 * threshold uses the model that threshold was written for.
 */
const MACHADO = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
};


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

/**
 * A hex colour as lightness, chroma and hue — the axes the picker moves along.
 *
 * OKLCH rather than HSL because every rule this tool has about colour is
 * measured in OKLab: the contrast floor, the distance between two series
 * through simulated colour blindness, the heat ramp climbing in steps of 0.06
 * lightness. A slider in this space moves the number the warning is about, and
 * a step of lightness looks like a step of lightness at every hue, which is the
 * one thing HSL cannot do.
 */
export function oklchOf(hex) {
  const [l, a, b] = oklabOf(hex);
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  return { l, c: Math.hypot(a, b), h: hue < 0 ? hue + 360 : hue };
}

/** The way back, pulled into sRGB by dropping chroma until it fits. */
export function hexOf(l, c, h) {
  return oklchToHex(Math.min(1, Math.max(0, l)), Math.max(0, c), h, 0) ?? "#000000";
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
