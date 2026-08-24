// @ts-check
import { seriesColour } from "./theme.js";

/**
 * What a slide is drawn on, when the reader wants more than a flat colour.
 *
 * Three rules hold all of this together, and every one of them was a decision
 * rather than a default:
 *
 * **It is repeatable.** "Randomly generated" cannot mean `Math.random`: the same
 * deck is drawn on screen, again in the contact sheet, and again into a PNG and
 * a PDF, and a backdrop that differed between those is three different pictures
 * of one slide. So the arrangement comes from a seeded generator keyed on the
 * slide's own id — every slide gets a different one, and the same slide gets the
 * same one for ever. Shuffling changes the seed in the config.
 *
 * **It stays out of the middle.** These are data slides. Blobs ride the edges of
 * the frame so what lands inside is the soft outside of a circle, rings are
 * swung from a corner, and grain thins towards the centre. The headline sits top
 * left, so that corner is left quietest of all.
 *
 * **It is not data.** Everything here goes in a `<g data-backdrop>` that
 * `coloursIn` in `deck.js` skips, so a backdrop never adds a well to "Colours
 * here" — that card answers what the *chart* encodes with, and the answer must
 * not change because someone turned on some shapes.
 */

const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

/**
 * Mulberry32, seeded off the slide id.
 *
 * Any small generator would do; what matters is that it is *ours* and therefore
 * stable. `Math.random` would reshuffle every slide on every paint, and a
 * backdrop that moves while the reader drags a colour slider is a backdrop that
 * looks broken.
 */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the slide id, mixed with the reader's shuffle. */
function seedOf(id, shuffle) {
  let hash = (2166136261 ^ (shuffle >>> 0)) >>> 0;
  for (let i = 0; i < id.length; i++) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 16777619) >>> 0;
  }
  return hash;
}

/**
 * The ground under one slide, or nothing at all.
 *
 * Appended straight after the surface and before anything else, so every mark,
 * rule and word on the slide is drawn over it.
 */
export function drawBackdrop(root, slide, theme, L) {
  const kind = theme.backdrop?.kind ?? "flat";
  if (kind === "flat" || !DRAW[kind]) return;

  const layer = el("g", { "data-backdrop": "" });
  DRAW[kind](layer, slide, theme, L, random(seedOf(slide.id ?? "", theme.backdrop?.seed ?? 0)));
  root.append(layer);
}

/**
 * Soft fields of colour, centred on the edge of the frame.
 *
 * Centres ride the border rather than the plot, so what shows is the outside of
 * a circle fading away — a blob centred in the frame is a target, and the
 * headline would be sitting on the bullseye. The gradient is what makes it soft;
 * a flat translucent disc has an edge, and an edge across a chart reads as a
 * boundary in the data.
 */
function blobs(layer, slide, theme, L, next) {
  const short = Math.min(L.width, L.height);
  const defs = el("defs");
  layer.append(defs);

  for (let i = 0; i < 5; i++) {
    const radius = short * (0.4 + next() * 0.45);
    const along = 0.12 + next() * 0.76;
    const side = Math.floor(next() * 4);
    const cx = side === 1 ? L.width : side === 3 ? 0 : L.width * along;
    const cy = side === 0 ? 0 : side === 2 ? L.height : L.height * along;

    // Unique across the page: the contact sheet puts every slide in one
    // document, and two `url(#blob0)` references would both find the first one.
    const id = `wdis-${slide.id}-${i}`;
    const hex = seriesColour(i, theme);

    defs.append(
      el(
        "radialGradient",
        { id },
        el("stop", { offset: "0", "stop-color": hex, "stop-opacity": theme.mode === "dark" ? 0.28 : 0.19 }),
        el("stop", { offset: "1", "stop-color": hex, "stop-opacity": 0 }),
      ),
    );
    layer.append(el("circle", { cx, cy, r: radius, fill: `url(#${id})` }));
  }
}

/**
 * Arcs swung from a corner — the one shape a camera suggests.
 *
 * Concentric and evenly spaced, because unevenly spaced rings read as data. The
 * corner is chosen by the seed but never the top left, which is where the
 * eyebrow and the headline are.
 */
function rings(layer, slide, theme, L, next) {
  const short = Math.min(L.width, L.height);
  const corner = 1 + Math.floor(next() * 3);
  const cx = corner === 1 ? L.width : corner === 2 ? L.width : 0;
  const cy = corner === 1 ? 0 : L.height;
  const gap = short * (0.11 + next() * 0.05);
  const width = Math.max(1, short * 0.0055);
  const hex = seriesColour(0, theme);

  for (let i = 1; i <= 9; i++) {
    layer.append(
      el("circle", {
        cx,
        cy,
        r: gap * i,
        fill: "none",
        stroke: hex,
        "stroke-width": width,
        opacity: theme.mode === "dark" ? 0.2 : 0.14,
      }),
    );
  }
}

/**
 * A thin scatter of dots, heavier at the edges than in the middle.
 *
 * The quietest of the three, and the only one that suits a slide with a lot on
 * it. Kept to a coarse grid on purpose: this is drawn once per slide and twenty
 * times over on the contact sheet, and a dot every ten pixels would be forty
 * thousand elements nobody asked for.
 */
function grain(layer, slide, theme, L, next) {
  const step = Math.max(26, Math.min(L.width, L.height) / 26);
  const dot = step * 0.11;
  const hex = seriesColour(0, theme);

  for (let x = step / 2; x < L.width; x += step) {
    for (let y = step / 2; y < L.height; y += step) {
      // Distance from the centre, roughly, as a 0..1 fade. The middle of the
      // frame is where the words are, so the middle is where the dots are not.
      const away = Math.max(
        Math.abs(x / L.width - 0.5) * 2,
        Math.abs(y / L.height - 0.5) * 2,
      );
      if (next() > away * away) continue;
      layer.append(
        el("circle", {
          cx: Math.round(x + (next() - 0.5) * step * 0.5),
          cy: Math.round(y + (next() - 0.5) * step * 0.5),
          r: dot,
          fill: hex,
          opacity: theme.mode === "dark" ? 0.28 : 0.2,
        }),
      );
    }
  }
}

const DRAW = { blobs, rings, grain };
