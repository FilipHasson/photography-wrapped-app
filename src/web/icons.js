// @ts-check
/**
 * The small drawings beside a milestone.
 *
 * **Drawn here, not fetched and not typed.** Nothing in this tool makes a
 * request, so an icon font or a sprite from a CDN is out by the same rule that
 * keeps the lettering to faces already on the machine. Emoji were the other
 * tempting answer and are worse: 📷 is a different picture on every platform,
 * there is no emoji for a lens at all, and none of them take the colour of the
 * text beside them.
 *
 * So each is a handful of lines on a 24×24 grid, stroked in `currentColor` with
 * no fill — which is what lets one drawing work on near-white paper and on
 * near-black without a second copy, and lets the row set the weight of it by
 * setting its own colour. The grid is the contract: everything stays inside it
 * with room for the stroke, and `test/page.test.ts` holds every shape to that,
 * because a coordinate outside the box is clipped silently rather than drawn
 * wrong.
 *
 * Boxes and round things are their own elements rather than arcs in a path, so
 * every number in a `d` is a coordinate and that check can be exact: `a2.6 2.6
 * 0 0 1` carries two radii and three flags, and a bounds check reading them as
 * positions is a check that fails on a drawing that is perfectly fine.
 *
 * What each one says is *what the milestone is about* — a camera, a lens, a
 * trip — never whether it was bought or sold. That half is a verb and the
 * label already carries it: "Bought the a9 III" beside a camera needs no plus
 * sign, and a plus and a minus that differ by three pixels at this size is a
 * distinction nobody can see.
 */

const NS = "http://www.w3.org/2000/svg";

/**
 * One icon per thing a milestone can be about.
 *
 * `d` holds one or more paths in a single string, split on `|`, because every
 * one of these is drawn with the same pen.
 */
const ICONS = {
  camera: {
    label: "Camera",
    // A body, the bump over the lens, the lens itself, and the lamp beside it.
    box: [{ x: 2.6, y: 7, w: 18.8, h: 12.6, rx: 2.6 }],
    d: "M8.6 7 L10 4.6 H14 L15.4 7",
    round: [
      { cx: 12, cy: 13.3, r: 3.9 },
      { cx: 17.8, cy: 10, r: 0.9, solid: true },
    ],
  },
  lens: {
    label: "Lens",
    // Head on, and the tick above it is the mount index. A barrel from the side
    // was the first try and it is a battery at the size this is actually used:
    // a rounded box with two lines across it, next to a rounded box with a
    // circle in it. Front on, the silhouette is nothing else in the set.
    box: [],
    d: "M12 2.6 V4.4",
    round: [
      { cx: 12, cy: 12.8, r: 8.4 },
      { cx: 12, cy: 12.8, r: 3.9 },
    ],
  },
  teleconverter: {
    label: "Teleconverter",
    // The same optic, smaller, beside the multiplier it is named for.
    box: [],
    d: "M17.6 5.2 L21 8.6|M21 5.2 L17.6 8.6",
    round: [
      { cx: 10.6, cy: 13.4, r: 6.6 },
      { cx: 10.6, cy: 13.4, r: 2.8 },
    ],
  },
  trip: {
    label: "Trip",
    box: [],
    d:
      "M12 2.4 C12.95 2.4 13.5 3.5 13.5 4.8 V9.5 L21 14 V16 L13.5 13.4 V18 " +
      "L15.8 19.7 V21.2 L12 20.1 L8.2 21.2 V19.7 L10.5 18 V13.4 L3 16 V14 " +
      "L10.5 9.5 V4.8 C10.5 3.5 11.05 2.4 12 2.4 Z",
    round: [],
  },
  shoot: {
    label: "Photoshoot",
    // Somebody in front of the camera. A tripod was the other candidate and
    // reads as a thing you bought, which is the one meaning it must not have.
    box: [],
    d: "M4.8 20.4 C4.8 16.3 8 13.8 12 13.8 C16 13.8 19.2 16.3 19.2 20.4",
    round: [{ cx: 12, cy: 8.4, r: 3.7 }],
  },
  custom: {
    label: "Milestone",
    box: [],
    d: "M6.4 3.2 V21|M6.4 5 H18.4 L15.8 8.9 L18.4 12.8 H6.4",
    round: [],
  },
};

/** The names, for anything that wants to check them all. */
export const ICON_NAMES = /** @type {Array<keyof typeof ICONS>} */ (Object.keys(ICONS));

export const iconSpec = (name) => ICONS[name] ?? ICONS.custom;

/**
 * Which icon a milestone gets.
 *
 * Off what it points at first: buying a lens and selling one are the same lens,
 * and a teleconverter is bought as a lens is — it has no category of its own in
 * the picker either, for the same reason. Only a milestone pointing at nothing
 * falls back to its kind.
 */
export function iconFor(anchor) {
  if (anchor?.gear?.dimension && anchor.gear.dimension in ICONS) return anchor.gear.dimension;
  if (anchor?.kind === "trip" || anchor?.kind === "shoot") return anchor.kind;
  return "custom";
}

/**
 * The icon as an element, named so it is not a picture of nothing.
 *
 * `role="img"` with the name on it rather than a bare `<svg>`: the row says
 * "Bought the a9 III", which is the event, and the icon says it was a camera —
 * on hover through the `<title>`, and to a reader who cannot see it through the
 * label. A drawing that says something the text does not must not be silent.
 */
export function drawIcon(name, className = "icon") {
  const spec = iconSpec(name);
  const svg = document.createElementNS(NS, "svg");

  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", spec.label);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const title = document.createElementNS(NS, "title");
  title.textContent = spec.label;
  svg.append(title);

  const add = (tag, attrs) => {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    svg.append(node);
  };

  for (const box of spec.box) {
    add("rect", { x: box.x, y: box.y, width: box.w, height: box.h, rx: box.rx });
  }
  for (const d of spec.d.split("|")) add("path", { d });
  for (const shape of spec.round) {
    // The camera's lamp is the one solid thing here: a ring of that size is a
    // smudge, and it is the one piece that is a light rather than an edge.
    add("ellipse", {
      cx: shape.cx,
      cy: shape.cy,
      rx: shape.r,
      ry: shape.ry ?? shape.r,
      ...(shape.solid ? { fill: "currentColor" } : {}),
    });
  }

  return svg;
}
