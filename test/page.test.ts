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
