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
let renderSlide: (slide: unknown, theme: unknown, format?: unknown) => ShimNode;
let LIGHT: unknown;
let DARK: unknown;
let FORMATS: Array<{ id: string; width: number; height: number }>;

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
    renderSlide: (slide: unknown, theme: unknown, format?: unknown) => ShimNode;
  });
  // @ts-expect-error — untyped module, imported for its values.
  ({ FORMATS } = (await import("../src/web/formats.js")) as {
    FORMATS: Array<{ id: string; width: number; height: number }>;
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

  test("every coordinate is a real number, in every shape", () => {
    for (const format of FORMATS) {
      for (const theme of [LIGHT, DARK]) {
        for (const slide of slides) {
          const svg = renderSlide(slide, theme, format);
          for (const node of svg.walk()) {
            for (const [key, value] of node.attrs) {
              if (!NUMERIC_ATTRS.has(key)) continue;
              assert.ok(
                Number.isFinite(Number(value)),
                `${format.id}/${slide.id}: ${node.tag}.${key} is "${value}"`,
              );
            }
          }
        }
      }
    }
  });

  test("nothing is drawn outside the frame, in every shape", () => {
    for (const format of FORMATS) {
      for (const slide of slides) {
        const svg = renderSlide(slide, LIGHT, format);
        for (const node of svg.walk()) {
          if (node.tag === "svg") continue;
          const x = Number(node.attrs.get("x") ?? 0);
          const y = Number(node.attrs.get("y") ?? 0);
          const width = Number(node.attrs.get("width") ?? 0);
          const height = Number(node.attrs.get("height") ?? 0);

          assert.ok(
            x >= -1 && x + width <= format.width + 1,
            `${format.id}/${slide.id}: ${node.tag} runs off the side (${x} + ${width})`,
          );
          assert.ok(
            y >= -1 && y + height <= format.height + 1,
            `${format.id}/${slide.id}: ${node.tag} runs off the bottom (${y} + ${height})`,
          );
        }
      }
    }
  });

  /**
   * The overlap that started this: tiles laid out for more room than the slide
   * had left, so a value sat on the label under it. Text has no box to measure,
   * so the check is on the baselines the tiles were drawn at.
   */
  test("no two lines of text sit on top of each other", () => {
    for (const format of FORMATS) {
      for (const slide of slides) {
        const svg = renderSlide(slide, LIGHT, format);
        const texts = [...svg.walk()]
          .filter((node) => node.tag === "text" && node.textContent.trim() !== "")
          .map((node) => ({
            x: Number(node.attrs.get("x") ?? 0),
            y: Number(node.attrs.get("y") ?? 0),
            size: Number(node.attrs.get("font-size") ?? 16),
            anchor: node.attrs.get("text-anchor") ?? "start",
            value: node.textContent,
          }));

        for (let i = 0; i < texts.length; i++) {
          for (let j = i + 1; j < texts.length; j++) {
            const a = texts[i]!;
            const b = texts[j]!;
            if (a.anchor !== b.anchor) continue;
            if (Math.abs(a.x - b.x) > 2) continue;
            const gap = Math.abs(a.y - b.y);
            if (gap === 0) continue;
            // Text grows upward from its baseline, so what has to fit is the
            // lower line s own height plus whatever the upper line s descenders
            // drop below it.
            const [upper, lower] = a.y < b.y ? [a, b] : [b, a];
            assert.ok(
              gap >= lower.size * 0.9 + upper.size * 0.12,
              `${format.id}/${slide.id}: "${upper.value}" (${upper.size}px) and "${lower.value}" (${lower.size}px) are ${gap.toFixed(1)}px apart`,
            );
          }
        }
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
      const svg = renderSlide(slide, LIGHT);
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

/**
 * The reader can ask for more rows than the default eight, and every one of
 * them has to land inside the frame with its label legible beside it. Long
 * lists are exactly where a layout tuned for eight rows falls over, so they are
 * checked against a manufactured slide rather than waiting for a fixture
 * library with forty lenses in it.
 */
describe("lists the reader has made longer", () => {
  const longBars = (rows: number): Slide => ({
    kind: "bars",
    id: "lenses",
    title: "Lenses",
    headline: "FE 200-600 G — 46% of your frames",
    items: Array.from({ length: rows }, (_, i) => ({
      label: `FE ${100 + i * 10}-${200 + i * 10}mm F2.8 GM OSS II`,
      value: rows * 100 - i * 90,
      valueLabel: `${(rows * 100 - i * 90).toLocaleString()}  ·  ${Math.max(1, 40 - i)}%`,
      share: Math.max(0.01, 0.4 - i * 0.01),
    })),
    table: { columns: ["Lens", "Photographs"], rows: [] },
  });

  for (const rows of [12, 20, 40]) {
    test(`${rows} bars stay inside the frame, in every shape`, () => {
      for (const format of FORMATS) {
        const svg = renderSlide(longBars(rows), LIGHT, format);
        for (const node of svg.walk()) {
          if (node.tag === "svg") continue;
          const x = Number(node.attrs.get("x") ?? 0);
          const y = Number(node.attrs.get("y") ?? 0);
          const width = Number(node.attrs.get("width") ?? 0);
          const height = Number(node.attrs.get("height") ?? 0);
          assert.ok(Number.isFinite(x + y + width + height), `${format.id}: ${node.tag} has a NaN`);
          assert.ok(
            x >= -1 && x + width <= format.width + 1 && y >= -1 && y + height <= format.height + 1,
            `${format.id}: ${rows} bars pushed a ${node.tag} out of the frame`,
          );
        }
      }
    });

    test(`${rows} bars keep their labels apart, in every shape`, () => {
      for (const format of FORMATS) {
        const svg = renderSlide(longBars(rows), LIGHT, format);
        const texts = [...svg.walk()]
          .filter((node) => node.tag === "text" && node.textContent.trim() !== "")
          .map((node) => ({
            x: Number(node.attrs.get("x") ?? 0),
            y: Number(node.attrs.get("y") ?? 0),
            size: Number(node.attrs.get("font-size") ?? 16),
            anchor: node.attrs.get("text-anchor") ?? "start",
            value: node.textContent,
          }));

        for (let i = 0; i < texts.length; i++) {
          for (let j = i + 1; j < texts.length; j++) {
            const a = texts[i]!;
            const b = texts[j]!;
            if (a.anchor !== b.anchor || Math.abs(a.x - b.x) > 2) continue;
            const gap = Math.abs(a.y - b.y);
            if (gap === 0) continue;
            const [upper, lower] = a.y < b.y ? [a, b] : [b, a];
            assert.ok(
              gap >= lower.size * 0.9 + upper.size * 0.12,
              `${format.id}: "${upper.value}" and "${lower.value}" are ${gap.toFixed(1)}px apart with ${rows} rows`,
            );
          }
        }
      }
    });
  }

  test("the eighth series still has a colour of its own", () => {
    const slide: Slide = {
      kind: "stack",
      id: "timeline",
      title: "Gear over time",
      headline: "How your kit rotated",
      months: [202501, 202502, 202503],
      series: Array.from({ length: 8 }, (_, i) => ({
        label: `Lens ${i + 1}`,
        values: [100 - i * 5, 90 - i * 5, 80 - i * 5],
        ...(i === 0 ? { converted: [30, 20, 10] } : {}),
      })),
      table: { columns: ["Month"], rows: [] },
    };

    const fills = new Set(
      [...renderSlide(slide, LIGHT).walk()]
        .filter((node) => node.tag === "rect")
        .map((node) => node.attrs.get("fill")),
    );
    // Eight lenses, one converter shade — nine fills, none of them repeated
    // from a slot that is already in use.
    assert.ok(fills.size >= 9, `only ${fills.size} distinct fills for eight series`);
  });
});
