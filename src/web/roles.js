// @ts-check
/**
 * Which palette roles a slide is drawn with, noted while it is being drawn.
 *
 * The panel beside a slide offers that slide's own colours, and something has
 * to know which they are. It used to read the hexes back off the finished
 * drawing and match each one to the role that resolves to it — exact, and free
 * of any table that could go stale, right up until two roles hold the same
 * colour. Two of them do, by design: Picked *is* the main colour, and the
 * weekend *is* series 2. So the opening slide, drawn in the main colour and
 * encoding no verdict at all, grew a well labelled "Picked", and a click on
 * that green had to guess which of the two it meant.
 *
 * Reading it off the drawing was still the right instinct — a map of slide to
 * roles kept by hand is a second source of truth, and wrong within a month of
 * the next slide. This records the same thing one step earlier: not the colour
 * that came out, but the role that was asked for. The theme reaches the
 * renderer through a proxy that notes every hex read out of it, so nothing is
 * declared anywhere, and a chart that starts using a new colour tomorrow
 * reports it the day it does.
 *
 * Only hexes are noted. `mode`, `type` and `backdrop` are read constantly and
 * none of them is a colour, so the rule that makes the list clean is the same
 * one the drawing itself follows: it starts with a `#` or it is not a colour.
 */

/** The way back to the real theme, for the one caller that must not be watched. */
const RAW = Symbol("theme");

const isHex = (value) => typeof value === "string" && value.startsWith("#");

/**
 * A theme that remembers what was taken from it, and the set doing the
 * remembering.
 *
 * `series` and `ramp` are lists, so they are proxied in turn and their reads
 * come back as `series.3` and `ramp.0` — the same ids the palette panel uses,
 * because they are the ids `colourAt` resolves. Reading `.length` or joining
 * the list notes nothing: neither hands back a colour.
 */
export function watchRoles(theme) {
  const used = new Set();
  const lists = new Map();

  const listOf = (list, prefix) => {
    let seen = lists.get(prefix);
    if (!seen) {
      seen = new Proxy(list, {
        get(target, key) {
          const value = Reflect.get(target, key);
          if (isHex(value)) used.add(`${prefix}.${String(key)}`);
          return value;
        },
      });
      lists.set(prefix, seen);
    }
    return seen;
  };

  const watched = new Proxy(theme, {
    get(target, key) {
      if (key === RAW) return target;
      const value = Reflect.get(target, key);
      if (isHex(value)) used.add(String(key));
      if (Array.isArray(value)) return listOf(value, String(key));
      return value;
    },
  });

  return { theme: watched, used };
}

/**
 * The theme as it really is, for the backdrop.
 *
 * Those shapes are decoration drawn from the same palette, and noting their
 * reads would put a well in "Colours here" for a colour the *chart* does not
 * use — that card answers what this slide encodes with, and the answer must not
 * change because somebody turned some shapes on. Handing back anything that is
 * not being watched unchanged means callers never have to ask.
 */
export function unwatched(theme) {
  return theme?.[RAW] ?? theme;
}

/** The roles a rendered slide says it was drawn with. */
export function rolesOf(root) {
  return new Set((root?.getAttribute?.("data-roles") ?? "").split(" ").filter(Boolean));
}
