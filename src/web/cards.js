// @ts-check
import { hexOf, oklchOf } from "./theme.js";

/**
 * The panel a number is set on, and the five ways it can be drawn.
 *
 * Four slides put something in a box: culling and keepers, the three figures
 * beside each year, and the ground the map is drawn on. They were all one flat
 * rectangle in `plane` — a colour barely a step off the paper, so on a plain
 * deck it was a shape you had to look for, and over a generated backdrop it was
 * a hole punched through it.
 *
 * The styles are decoration, and everything decoration has to obey here applies:
 *
 * **The palette is the reader's.** Every colour below is a role or a shade
 * *computed* from one, never a hex written here — so a card follows the scheme,
 * the mode and any well the reader has touched. `lift` is the whole trick: it
 * moves a colour along OKLCH lightness, which is why one rule for "a step
 * lighter than the card" works on near-white paper and on near-black alike, and
 * why none of this needs to ask which mode it is in.
 *
 * **It is not data.** A card never adds a well to "Colours here" — `coloursIn`
 * collects hexes off `fill` and `stroke`, and a `url(...)` is not one, so the
 * gradient styles are invisible to it by construction. The one style that does
 * write a hex writes `plane` and `grid`, which are page roles and in Style
 * already.
 *
 * **Ids carry the slide's id.** The contact sheet puts every slide in one
 * document, where two `url(#card)` would both find the first one.
 */

const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) if (child) node.append(child);
  return node;
}

function titled(node, label) {
  if (!label) return node;
  const title = el("title");
  title.textContent = label;
  node.append(title);
  return node;
}

/**
 * A colour moved along lightness, keeping its hue and its chroma.
 *
 * In OKLCH, so a step of lightness looks like a step of lightness whatever the
 * hue — the same reason the picker's sliders are in that space. This is what
 * lets "a shade lighter than the card" and "a shade darker" be one rule rather
 * than two branches on the mode: on near-white paper `+0.06` is a faint sheen
 * and on near-black it is a visible edge, which is exactly right both times.
 */
function lift(hex, by) {
  const { l, c, h } = oklchOf(hex);
  return hexOf(Math.min(1, Math.max(0, l + by)), c, h);
}

/**
 * What the styles are, in the order the chips offer them.
 *
 * Glass first because it is the default and the one the rest are alternatives
 * to. Flat last but one is the original, kept deliberately: a reader who wants
 * a plain panel should not have to want it in vain.
 */
export const CARD_STYLES = [
  { id: "glass", label: "Glass", note: "translucent, lit along the top edge" },
  { id: "soft", label: "Soft", note: "raised off the page by two shadows" },
  { id: "outline", label: "Outline", note: "a rule and nothing else" },
  { id: "tinted", label: "Tinted", note: "a wash of the colour it carries" },
  { id: "flat", label: "Flat", note: "a plain filled panel" },
];

export const cardStyleById = (id) => CARD_STYLES.find((one) => one.id === id) ?? CARD_STYLES[0];

/**
 * Opens a `<defs>` for one slide and hands back the function that paints a card.
 *
 * The painter takes `(box, title, accent)`. `accent` is the colour that card is
 * *about* — the verdict's own blue or red, the series colour on a year — and
 * only the tinted style spends it; the others take it and ignore it, so no
 * caller has to know which style is on.
 *
 * Definitions are made once per slide where the style allows it and cached per
 * accent where it does not, because `objectBoundingBox` is a gradient's default:
 * one vertical ramp fits every card on the slide whatever its size.
 */
export function cardsOf(root, slide, theme) {
  const style = cardStyleById(theme.cardStyle).id;
  const defs = el("defs");
  root.append(defs);

  const id = (suffix) => `wdis-card-${slide.id ?? "x"}-${suffix}`;
  const made = new Map();
  /** A definition per key, made the first time it is asked for. */
  const define = (key, build) => {
    if (!made.has(key)) {
      made.set(key, id(key));
      defs.append(build(id(key)));
    }
    return made.get(key);
  };

  const paint = PAINTERS[style] ?? PAINTERS.glass;
  return (box, title, accent) =>
    paint(root, { rx: 14, ...box }, theme, define, accent ?? theme.series[0], title);
}

/**
 * Translucent, and lit where the light would catch it.
 *
 * The fill fades down the card so whatever is under the slide carries on
 * through it, which means the *edge* has to say where the card is: a second
 * rect, inset by a pixel, strokes a ramp that is bright at the top and gone by
 * the middle — light on the near edge of a pane of glass rather than an outline
 * around it. `surface` is the highlight in both modes without asking which,
 * because it is lighter than `plane` in both.
 */
function glass(root, box, theme, define, _accent, title) {
  const body = define("glass", (name) =>
    el(
      "linearGradient",
      { id: name, x1: 0, y1: 0, x2: 0, y2: 1 },
      el("stop", { offset: "0", "stop-color": theme.plane, "stop-opacity": 0.88 }),
      el("stop", { offset: "1", "stop-color": theme.plane, "stop-opacity": 0.34 }),
    ),
  );
  const rim = define("rim", (name) =>
    el(
      "linearGradient",
      { id: name, x1: 0, y1: 0, x2: 0, y2: 1 },
      el("stop", { offset: "0", "stop-color": theme.surface, "stop-opacity": 0.95 }),
      el("stop", { offset: "0.55", "stop-color": theme.surface, "stop-opacity": 0 }),
    ),
  );

  root.append(
    titled(el("rect", { ...box, fill: `url(#${body})`, stroke: theme.grid }), title),
    inset(box, box.rx, { fill: "none", stroke: `url(#${rim})` }),
  );
}

/**
 * Raised off the page rather than drawn on it.
 *
 * The card is the paper's own colour and the shadows do all the work: one dark
 * below and right, one light above and left, which is the whole of the trick —
 * a shape lit from the top left has to be both, or it reads as a sticker. Both
 * are `lift`ed from the surface, so a scheme with a warm paper gets warm
 * shadows and the dark mode gets its own without a branch.
 *
 * No filter region is set on purpose. The default reaches ten per cent of the
 * card beyond each edge, which comfortably holds this blur — and every number
 * `test/render.test.ts` reads off an element has to be a number, which a
 * percentage in `x` is not.
 */
function soft(root, box, theme, define, _accent, title) {
  const filter = define("soft", (name) =>
    el(
      "filter",
      { id: name },
      el("feDropShadow", {
        in: "SourceGraphic",
        dx: 3,
        dy: 4,
        stdDeviation: 5,
        "flood-color": lift(theme.surface, -0.16),
        "flood-opacity": 0.55,
        result: "cast",
      }),
      el("feDropShadow", {
        in: "cast",
        dx: -3,
        dy: -4,
        stdDeviation: 5,
        "flood-color": lift(theme.surface, 0.1),
        "flood-opacity": 0.6,
      }),
    ),
  );

  root.append(
    titled(
      el("rect", { ...box, rx: Math.max(box.rx, 16), fill: theme.surface, filter: `url(#${filter})` }),
      title,
    ),
  );
}

/**
 * A rule around nothing.
 *
 * The one style with no fill at all, which makes it the only one that shows a
 * backdrop through the card completely — and the only one that survives being
 * printed, photocopied or read at the size a phone puts a contact sheet at.
 * Square corners and a two-pixel stroke because the softness is the point of
 * the other four: this is the editorial answer, and a rounded outline is
 * neither one thing nor the other.
 */
function outline(root, box, theme, _define, _accent, title) {
  root.append(
    titled(el("rect", { ...box, rx: 0, fill: "none", stroke: theme.ink2, "stroke-width": 2 }), title),
  );
}

/**
 * A wash of whatever the card is about.
 *
 * The only style that spends the accent: a picked card is washed in the blue
 * its number is set in, a rejected one in the red, a year's leading figure in
 * the series colour. Diagonal, and faint at the far corner, so it reads as
 * light falling across a card rather than as a filled block — a solid tint at
 * this strength is a coloured rectangle, and a coloured rectangle beside a
 * chart is something the reader will try to decode.
 *
 * Cached per accent, since two cards on one slide are usually about different
 * things.
 */
function tinted(root, box, theme, define, accent, title) {
  const key = `tint-${accent.replace("#", "")}`;
  const wash = define(key, (name) =>
    el(
      "linearGradient",
      { id: name, x1: 0, y1: 0, x2: 1, y2: 1 },
      el("stop", { offset: "0", "stop-color": accent, "stop-opacity": theme.mode === "dark" ? 0.3 : 0.2 }),
      el("stop", { offset: "1", "stop-color": accent, "stop-opacity": theme.mode === "dark" ? 0.07 : 0.04 }),
    ),
  );

  root.append(
    titled(
      el("rect", { ...box, rx: Math.max(box.rx, 16), fill: `url(#${wash})` }),
      title,
    ),
    inset(box, Math.max(box.rx, 16), { fill: "none", stroke: accent, "stroke-opacity": 0.28 }),
  );
}

/** The panel as it always was: `plane`, a hairline, and nothing else. */
function flat(root, box, theme, _define, _accent, title) {
  root.append(titled(el("rect", { ...box, fill: theme.plane, stroke: theme.grid }), title));
}

/**
 * The same box, a pixel in.
 *
 * Clamped, because a card can be drawn very short — the row under the verdicts
 * on a 16:9 frame is a couple of dozen pixels — and a negative width is a shape
 * a browser drops without a word.
 */
function inset(box, rx, attrs) {
  return el("rect", {
    x: box.x + 1,
    y: box.y + 1,
    width: Math.max(0, box.width - 2),
    height: Math.max(0, box.height - 2),
    rx: Math.max(0, rx - 1),
    ...attrs,
  });
}

const PAINTERS = { glass, soft, outline, tinted, flat };
