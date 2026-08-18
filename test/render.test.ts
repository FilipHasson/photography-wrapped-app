import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Db } from "../src/core/db.ts";
import { defaultConfig, defaultSource } from "../src/core/config.ts";
import { indexSource, indexOverview } from "../src/index/source.ts";
import { computeStats } from "../src/stats/aggregate.ts";
import { buildDeck, type Slide } from "../src/stats/slides.ts";
import { resolveRange } from "../src/stats/range.ts";
import { makeFixtures } from "../tools/make-fixtures.ts";

/**
 * Renders every slide without a browser.
 *
 * The drawing code is plain DOM calls, so a shim of the four methods it uses is
 * enough to run it here. What that buys is the check that actually matters:
 * a single `NaN` in a coordinate makes an SVG element silently vanish, and a
 * bar drawn past the frame is invisible rather than wrong-looking — neither
 * shows up as an error anywhere, in a browser or out of it.
 */

const NUMERIC_ATTRS = new Set([
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "width", "height", "rx", "opacity",
  "font-size", "stroke-width", "fill-opacity",
]);

class ShimNode {
  tag: string;
  attrs = new Map<string, string>();
  children: ShimNode[] = [];
  textContent = "";

  constructor(tag: string) {
    this.tag = tag;
  }

  setAttribute(key: string, value: string): void {
    this.attrs.set(key, value);
  }

  append(...nodes: unknown[]): void {
    for (const node of nodes) {
      if (node instanceof ShimNode) this.children.push(node);
    }
  }

  *walk(): Generator<ShimNode> {
    yield this;
    for (const child of this.children) yield* child.walk();
  }
}

/**
 * Character-width approximation, in place of a real font. The drawing code only
 * ever compares measurements against each other, so a consistent approximation
 * exercises every branch — it just cannot prove a label looks right.
 */
function measureText(value: string, size: number): { width: number } {
  return { width: value.length * size * 0.52 };
}

function installShim(): void {
  const canvasContext = {
    font: "16px sans",
    measureText(value: string) {
      const size = Number(this.font.match(/(\d+)px/)?.[1] ?? 16);
      return measureText(value, size);
    },
  };

  (globalThis as Record<string, unknown>).document = {
    createElementNS: (_ns: string, tag: string) => new ShimNode(tag),
    createElement: (tag: string) =>
      tag === "canvas" ? { getContext: () => canvasContext } : new ShimNode(tag),
  };
}

let root = "";
let db: Db;
let slides: Slide[] = [];
let renderSlide: (slide: unknown, theme: unknown, position?: string) => ShimNode;
let LIGHT: unknown;
let DARK: unknown;

before(async () => {
  installShim();

  root = await fs.mkdtemp(path.join(os.tmpdir(), "wdis-render-"));
  await makeFixtures(path.join(root, "library"));

  db = new Db(":memory:");
  const config = defaultConfig();
  const source = defaultSource({ path: path.join(root, "library"), label: "Library" });
  config.sources.push(source);
  await indexSource(db, source, config);

  const overview = indexOverview(db);
  const range = resolveRange({ kind: "all" }, { firstDay: overview.firstDay, lastDay: overview.lastDay });
  slides = buildDeck(computeStats(db, range, { includeVideo: true }), "Filip").slides;

  // The web modules are plain JS with `// @ts-check` for the editor's benefit;
  // `npm run typecheck` covers the TypeScript, as in the sibling project. The
  // shapes asserted here are the ones this file uses.
  // @ts-expect-error — untyped module, imported for its behaviour.
  ({ renderSlide } = (await import("../src/web/chart.js")) as {
    renderSlide: (slide: unknown, theme: unknown, position?: string) => ShimNode;
  });
  // @ts-expect-error — untyped module, imported for its values.
  ({ LIGHT, DARK } = (await import("../src/web/theme.js")) as { LIGHT: unknown; DARK: unknown });
});

after(async () => {
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe("rendering", () => {
  test("draws every kind of slide the deck can produce", () => {
    const kinds = new Set(slides.map((slide) => slide.kind));
    // The fixtures are built to exercise the lot; if one stops appearing, the
    // renderer for it stops being tested.
    for (const kind of ["hero", "bars", "columns", "clock", "week", "calendar", "stack", "map", "tiles", "list"]) {
      assert.ok(kinds.has(kind as Slide["kind"]), `no ${kind} slide in the deck`);
    }
  });

  test("every coordinate is a real number", () => {
    for (const theme of [LIGHT, DARK]) {
      for (const slide of slides) {
        const svg = renderSlide(slide, theme, "1 / 20");
        for (const node of svg.walk()) {
          for (const [key, value] of node.attrs) {
            if (!NUMERIC_ATTRS.has(key)) continue;
            const numeric = Number(value);
            assert.ok(
              Number.isFinite(numeric),
              `${slide.id}: ${node.tag}.${key} is "${value}"`,
            );
          }
        }
      }
    }
  });

  test("nothing is drawn outside the frame", () => {
    for (const slide of slides) {
      const svg = renderSlide(slide, LIGHT, "1 / 20");
      for (const node of svg.walk()) {
        if (node.tag === "svg") continue;
        const x = Number(node.attrs.get("x") ?? 0);
        const y = Number(node.attrs.get("y") ?? 0);
        const width = Number(node.attrs.get("width") ?? 0);
        const height = Number(node.attrs.get("height") ?? 0);

        assert.ok(x >= -1 && x + width <= 1601, `${slide.id}: ${node.tag} runs off the side (${x} + ${width})`);
        assert.ok(y >= -1 && y + height <= 901, `${slide.id}: ${node.tag} runs off the bottom (${y} + ${height})`);
      }
    }
  });

  test("every mark says what it is on hover", () => {
    for (const slide of slides) {
      if (slide.kind === "hero" || slide.kind === "tiles" || slide.kind === "list") continue;
      const svg = renderSlide(slide, LIGHT);
      const titles = [...svg.walk()].filter((node) => node.tag === "title");
      assert.ok(titles.length > 0, `${slide.id} has no hover labels`);
      for (const title of titles) {
        assert.ok(title.textContent.length > 0, `${slide.id} has an empty hover label`);
      }
    }
  });

  test("a legend appears wherever there is more than one series", () => {
    const stack = slides.find((slide) => slide.kind === "stack");
    assert.ok(stack, "expected a stacked slide");

    const svg = renderSlide(stack, LIGHT);
    const labels = [...svg.walk()]
      .filter((node) => node.tag === "text")
      .map((node) => node.textContent);

    if (stack.kind === "stack") {
      for (const series of stack.series) {
        const shown = labels.some((label) => label.startsWith(series.label.slice(0, 12)));
        assert.ok(shown, `the legend is missing "${series.label}"`);
      }
    }
  });

  test("the headline and title always make it onto the slide", () => {
    for (const slide of slides) {
      const svg = renderSlide(slide, LIGHT, "3 / 20");
      const texts = [...svg.walk()].filter((node) => node.tag === "text").map((node) => node.textContent);
      assert.ok(
        texts.some((value) => value === slide.title.toUpperCase()),
        `${slide.id} lost its title`,
      );
      assert.ok(
        texts.some((value) => slide.headline.startsWith(value.replace(/ …$/, "").trim())),
        `${slide.id} lost its headline`,
      );
    }
  });
});
