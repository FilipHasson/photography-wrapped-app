import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The page's own markup and stylesheet, checked without a browser.
 *
 * One rule, and it has cost real time twice: **a class that sets a display
 * beats the browser's own `[hidden]`**. `[hidden] { display: none }` comes from
 * the user-agent stylesheet, so any rule of ours with a class selector wins on
 * specificity and the element never goes away. Nothing throws, nothing looks
 * wrong in the source, and the thing simply sits there — which is exactly how
 * an empty progress bar spent a week stuck at the top of the page.
 */

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "web");
const read = (name: string) => fs.readFileSync(path.join(web, name), "utf8");

const html = read("index.html");
const css = read("style.css").replace(/\/\*[\s\S]*?\*\//g, "");
const scripts = ["app.js", "deck.js"].map(read).join("\n");

/**
 * Every rule in the sheet, innermost first.
 *
 * A body cannot contain a brace, which is what makes this safe against the
 * `@media` blocks: the engine skips the wrapper and matches the rules inside it.
 */
const RULES = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((match) => ({
  selectors: (match[1] ?? "").split(",").map((one) => one.trim()),
  body: match[2] ?? "",
}));

/** Elements hidden in the markup, or hidden from script. */
function hideable(): Array<{ id: string; classes: string[] }> {
  const ids = new Set([
    ...[...html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*\bhidden\b[^>]*>/g)].map((m) => m[1] as string),
    ...[...scripts.matchAll(/\$\("([^"]+)"\)\.hidden\s*=/g)].map((m) => m[1] as string),
    ...[...scripts.matchAll(/getElementById\("([^"]+)"\)\.hidden\s*=/g)].map((m) => m[1] as string),
  ]);

  return [...ids].sort().map((id) => ({ id, classes: classesOf(id) }));
}

/**
 * The classes on one element, found without building a pattern.
 *
 * Deliberately not a regex: an id goes into the middle of one, and a pattern
 * assembled in a template literal is where an escape quietly becomes something
 * else — `\b` there is a backspace, not a word boundary, and the check it
 * belonged to passed by matching nothing at all.
 */
function classesOf(id: string): string[] {
  const at = html.indexOf(`id="${id}"`);
  if (at < 0) return [];

  const open = html.lastIndexOf("<", at);
  const close = html.indexOf(">", at);
  if (open < 0 || close < 0) return [];

  const tag = html.slice(open, close + 1);
  return tag.match(/class="([^"]+)"/)?.[1]?.split(/\s+/) ?? [];
}

/** True when some rule naming exactly this selector sets a display. */
const setsDisplay = (target: string) =>
  RULES.some(
    (rule) =>
      rule.selectors.some((selector) => selector.split(/\s+/).includes(target)) &&
      /display\s*:/.test(rule.body),
  );

const hasGuard = (target: string) =>
  RULES.some((rule) => rule.selectors.some((selector) => selector.endsWith(`${target}[hidden]`)));

describe("the page", () => {
  test("finds the elements it is meant to be checking", () => {
    const found = hideable();
    // A check that quietly matched nothing would pass for ever, which is what
    // the first version of this file did.
    for (const id of ["job-banner", "stale-banner", "view-deck", "deck-table", "toast"]) {
      assert.ok(
        found.some((element) => element.id === id),
        `the audit no longer sees #${id}`,
      );
    }
    assert.ok(RULES.length > 100, `only ${RULES.length} rules parsed out of the stylesheet`);
    assert.deepEqual(classesOf("job-banner"), ["job-banner"]);
    assert.ok(setsDisplay(".job-banner"), "the stylesheet is no longer being read");
  });

  test("every element the script reaches for is in the markup", () => {
    // `$("colour-wells")` returning null throws on the next line and takes the
    // whole page with it — there is no partial render here, so one wrong id in
    // a panel nobody has opened yet is a blank screen. Only the literal ones
    // can be checked from here, which is most of them.
    const missing: string[] = [];

    for (const match of scripts.matchAll(/[$]\("([a-z0-9-]+)"\)/g)) {
      const id = match[1] as string;
      if (!html.includes(`id="${id}"`)) missing.push(id);
    }

    assert.deepEqual([...new Set(missing)], []);
  });

  test("the pieces of the colour picker are all there", () => {
    // Built from a template literal, so the check above cannot see them.
    for (const id of ["colour-light", "colour-dark", "colour-reset", "colour-all", "colour-wells", "page-wells", "colour-problems", "scheme-chips"]) {
      assert.ok(html.includes(`id="${id}"`), `the colour picker has lost #${id}`);
    }
  });

  test("everything it hides can actually be hidden", () => {
    const broken: string[] = [];

    for (const { id, classes } of hideable()) {
      const targets = [`#${id}`, ...classes.map((one) => `.${one}`)];
      const showing = targets.filter(setsDisplay);

      // One guard is enough for the whole element: `.view[hidden]` is a class
      // and an attribute, so it outranks any plain class rule — which is how
      // `<section class="view deck">` stays hideable with `.deck` setting a
      // display of its own.
      if (showing.length > 0 && !targets.some(hasGuard)) {
        broken.push(`#${id}: ${showing.join(", ")} set a display, and nothing here beats [hidden]`);
      }
    }

    assert.deepEqual(broken, []);
  });

  test("the stylesheet's own guards still name something", () => {
    // The other half of the same mistake: a `[hidden]` rule left behind for an
    // element that no longer exists is a rule nobody will think to question.
    for (const rule of RULES) {
      for (const selector of rule.selectors) {
        const guard = selector.match(/^\.([a-z-]+)\[hidden\]$/);
        if (!guard) continue;
        assert.ok(
          html.includes(`class="${guard[1]}`) || html.includes(` ${guard[1]}"`) || scripts.includes(guard[1] as string),
          `.${guard[1]}[hidden] guards a class the page no longer has`,
        );
      }
    }
  });
});

/**
 * The drawings beside a milestone.
 *
 * Hand-drawn on a 24×24 grid, because nothing here makes a request and emoji
 * are a different picture on every machine. Two things can go wrong with a
 * drawing written as numbers, and neither of them looks like an error: a
 * coordinate outside the box is **clipped silently** — a wingtip simply is not
 * there — and an icon nobody named is a picture a screen reader cannot read
 * out. Both are checked here rather than in `render.test.ts`, which is about
 * the slides; these are the page's.
 */
// @ts-expect-error — untyped module, imported for its behaviour, the same
// arrangement `render.test.ts` uses for the drawing code.
const { ICON_NAMES, iconSpec, iconFor, drawIcon } = (await import("../src/web/icons.js")) as {
  ICON_NAMES: string[];
  iconSpec: (name: string) => {
    label: string;
    d: string;
    box: Array<Record<string, number>>;
    round: Array<Record<string, number>>;
  };
  iconFor: (anchor: unknown) => string;
  drawIcon: (name: string, className?: string) => unknown;
};

describe("the light and dark toggle", () => {
  test("is set before the stylesheet, so a stored choice never flashes", () => {
    const script = html.indexOf('<script src="/theme-toggle.js"></script>');
    assert.ok(script >= 0 && script < html.indexOf('rel="stylesheet"'));
  });

  test("the slides follow it, not only the OS", () => {
    assert.ok(read("theme.js").includes("documentElement.dataset.theme"), "exports would ignore the toggle");
    assert.ok(scripts.includes('"themechange"'), "the deck on screen would not redraw");
  });
});

describe("the milestone icons", () => {
  /**
   * Every number in the drawing, whatever shape it came from.
   *
   * Straight out of `d` for the paths, which is only safe because none of them
   * draws an arc — an arc carries two radii and three flags among its numbers,
   * and a zero flag read as a position fails a drawing that is perfectly fine.
   * Boxes and round things are elements for that reason, and become their own
   * edges here.
   */
  const coordsOf = (name: string) => {
    const spec = iconSpec(name);
    const out = [...spec.d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    for (const box of spec.box) {
      out.push(box.x!, box.x! + box.w!, box.y!, box.y! + box.h!);
    }
    for (const shape of spec.round) {
      out.push(
        shape.cx! - (shape.r ?? 0),
        shape.cx! + (shape.r ?? 0),
        shape.cy! - (shape.ry ?? shape.r ?? 0),
        shape.cy! + (shape.ry ?? shape.r ?? 0),
      );
    }
    return out;
  };

  test("every one of them stays inside its box, stroke and all", () => {
    // The stroke is 1.7 and straddles the line it is on, so the drawing itself
    // has to stop short of the edge by rather more than nothing.
    for (const name of ICON_NAMES) {
      for (const value of coordsOf(name)) {
        assert.ok(
          Number.isFinite(value) && value >= 0.85 && value <= 23.15,
          `${name}: ${value} is outside the 24×24 grid, and would be clipped`,
        );
      }
    }
  });

  test("every one of them fills enough of it to be seen", () => {
    // The other half: an icon drawn in a corner of the grid is a speck beside
    // the ones that are not, and nothing about it looks wrong in the source.
    for (const name of ICON_NAMES) {
      const all = coordsOf(name);
      const size = Math.max(...all) - Math.min(...all);
      assert.ok(size > 14, `${name} spans only ${size} of 24`);
    }
  });

  test("every one of them is named", () => {
    for (const name of ICON_NAMES) {
      assert.ok((iconSpec(name).label ?? "").length > 0, `${name} has no name`);
    }
  });

  test("a milestone gets the icon for what it points at", () => {
    // What it is about, not what was done to it: buying a lens and selling one
    // are the same lens, and a teleconverter is bought the way a lens is.
    assert.equal(iconFor({ kind: "bought", gear: { dimension: "camera" } }), "camera");
    assert.equal(iconFor({ kind: "sold", gear: { dimension: "camera" } }), "camera");
    assert.equal(iconFor({ kind: "bought", gear: { dimension: "lens" } }), "lens");
    assert.equal(iconFor({ kind: "bought", gear: { dimension: "teleconverter" } }), "teleconverter");
    assert.equal(iconFor({ kind: "trip" }), "trip");
    assert.equal(iconFor({ kind: "shoot" }), "shoot");
    assert.equal(iconFor({ kind: "custom" }), "custom");

    // An old milestone from before there were categories, and anything that
    // arrives claiming a kind this does not have: a picture, never a gap.
    assert.equal(iconFor({}), "custom");
    assert.equal(iconFor({ kind: "bought" }), "custom");
    assert.equal(iconFor({ kind: "nonsense", gear: { dimension: "tripod" } }), "custom");
  });

  test("the drawing says what it is to a reader who cannot see it", () => {
    const made: Array<{ tag: string; attrs: Map<string, string>; children: unknown[]; textContent: string }> = [];
    const shim = {
      createElementNS: (_ns: string, tag: string) => {
        const node = {
          tag,
          attrs: new Map<string, string>(),
          children: [] as unknown[],
          textContent: "",
          setAttribute(key: string, value: string) {
            this.attrs.set(key, value);
          },
          append(...kids: unknown[]) {
            this.children.push(...kids);
          },
        };
        made.push(node);
        return node;
      },
    };
    const had = (globalThis as Record<string, unknown>).document;
    (globalThis as Record<string, unknown>).document = shim;

    try {
      for (const name of ICON_NAMES) {
        const svg = drawIcon(name, "anchor-icon") as unknown as (typeof made)[number];
        assert.equal(svg.attrs.get("role"), "img", `${name} is not marked as a picture`);
        assert.equal(svg.attrs.get("aria-label"), iconSpec(name).label);
        assert.equal(svg.attrs.get("class"), "anchor-icon");
        // In the reader's own ink, so one drawing works on both papers.
        assert.equal(svg.attrs.get("stroke"), "currentColor");
        assert.equal(svg.attrs.get("viewBox"), "0 0 24 24");

        const titles = (svg.children as Array<{ tag: string; textContent: string }>).filter(
          (child) => child.tag === "title",
        );
        assert.equal(titles.length, 1, `${name} has ${titles.length} names on hover`);
        assert.equal(titles[0]?.textContent, iconSpec(name).label);
      }
    } finally {
      (globalThis as Record<string, unknown>).document = had;
    }
  });

  test("the page has somewhere to put one", () => {
    assert.ok(scripts.includes("anchor-icon"), "nothing draws an icon beside a milestone");
    assert.ok(/\.anchor-icon\b/.test(css), "the icon has no size in the stylesheet");
  });
});
