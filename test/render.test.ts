import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Db } from "../src/core/db.ts";
import { defaultConfig, defaultSource, makeAnchor } from "../src/core/config.ts";
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

/** The same approximation, for tests that need to know how wide a label came out. */
const measureShim = (value: string, size: number) => measureText(value, size).width;

function installShim(): void {
  const canvasContext = {
    font: "16px sans",
    measureText(value: string) {
      // Fractional sizes are real — charts scale their type to fit — and a
      // pattern that only matched whole numbers read `38.66px` as 66px, which
      // is a shim quietly lying to every layout that measures.
      const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 16);
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

  // Milestones on days the fixtures actually hold, so every slide that draws
  // time is checked with its annotations on rather than without them.
  const anchors = [
    makeAnchor("Bought the Nikon Z 8", overview.firstDay ?? 20250101, [], {
      kind: "bought",
      gear: { dimension: "camera", key: "nikonz8" },
    }),
    makeAnchor("Moved to Lisbon", overview.lastDay ?? 20251231, []),
  ];

  slides = buildDeck(computeStats(db, range, { includeVideo: true, anchors }), "Filip").slides;

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

/**
 * Past the palette's eight documented slots the colours are generated, and the
 * thing that must hold is that they are *different from each other* — a chart
 * of twenty-five lenses where two of them share a colour is a chart that lies.
 */
describe("colours past the palette", () => {
  test("the documented eight are never touched", async () => {
    // @ts-expect-error — untyped module, imported for its behaviour.
    const { seriesColour } = (await import("../src/web/theme.js")) as {
      seriesColour: (index: number, theme: unknown) => string;
    };

    for (const theme of [LIGHT, DARK] as Array<{ series: string[] }>) {
      theme.series.forEach((hex, index) => {
        assert.equal(seriesColour(index, theme), hex, `slot ${index} moved`);
      });
    }
  });

  test("twenty-five series are twenty-five colours", async () => {
    // @ts-expect-error — untyped module, imported for its behaviour.
    const { seriesColour } = (await import("../src/web/theme.js")) as {
      seriesColour: (index: number, theme: unknown) => string;
    };

    for (const theme of [LIGHT, DARK]) {
      const colours = Array.from({ length: 25 }, (_, i) => seriesColour(i, theme));
      assert.equal(new Set(colours).size, 25, colours.join(","));
      for (const hex of colours) assert.match(hex, /^#[0-9a-f]{6}$/);
    }
  });
});

/**
 * The long view is months down the page, and a library that reaches back years
 * puts two of them a row apart: only months holding photographs are rows, so a
 * single frame in 2019 and another in 2020 are neighbours. The margin has to
 * choose what it can fit rather than write both years on top of each other.
 */
describe("months down the page", () => {
  const sparse = [
    { ym: 201806, shots: 4 },
    { ym: 201903, shots: 2 },
    { ym: 202011, shots: 9 },
    ...Array.from({ length: 30 }, (_, i) => ({
      ym: 202401 + (i % 12) + Math.floor(i / 12) * 100,
      shots: 100 + i * 40,
    })),
  ];

  const slide: Slide = {
    kind: "months",
    id: "calendar",
    title: "Month by month",
    headline: "22 Feb 2025 — 10,061 photographs in one day",
    note: "You were out on 383 days, 14% of the period",
    months: sparse,
    marks: [
      { day: 20180615, label: "+ a7 II", full: "Bought the a7 II · 15 June 2018" },
      // A month with nothing in it: the mark still has a place on the axis.
      { day: 20211101, label: "+ FE 200-600mm G", full: "Bought the FE 200-600mm G · 1 November 2021" },
      { day: 20240917, label: "+ a9 III", full: "Bought the a9 III · 17 September 2024" },
      { day: 20250501, label: "Moved to Lisbon", full: "Moved to Lisbon · 1 May 2025" },
    ],
    table: { columns: ["Month", "Photographs"], rows: [] },
  };

  test("keeps every bar and label inside the frame", () => {
    for (const format of FORMATS) {
      for (const theme of [LIGHT, DARK]) {
        for (const node of renderSlide(slide, theme, format).walk()) {
          if (node.tag === "svg") continue;
          const x = Number(node.attrs.get("x") ?? 0);
          const y = Number(node.attrs.get("y") ?? 0);
          const width = Number(node.attrs.get("width") ?? 0);
          const height = Number(node.attrs.get("height") ?? 0);
          assert.ok(Number.isFinite(x + y + width + height), `${format.id}: ${node.tag} has a NaN`);
          assert.ok(
            x >= -1 && x + width <= format.width + 1 && y >= -1 && y + height <= format.height + 1,
            `${format.id}: a ${node.tag} left the frame at ${x},${y}`,
          );
        }
      }
    }
  });

  test("never writes one year over another", () => {
    for (const format of FORMATS) {
      const margin = [...renderSlide(slide, LIGHT, format).walk()]
        .filter((node) => node.tag === "text" && node.attrs.get("text-anchor") === "end")
        .map((node) => ({
          x: Number(node.attrs.get("x") ?? 0),
          y: Number(node.attrs.get("y") ?? 0),
          size: Number(node.attrs.get("font-size") ?? 16),
          value: node.textContent,
        }));

      for (let i = 0; i < margin.length; i++) {
        for (let j = i + 1; j < margin.length; j++) {
          const a = margin[i]!;
          const b = margin[j]!;
          if (Math.abs(a.x - b.x) > 2) continue;
          const gap = Math.abs(a.y - b.y);
          const [upper, lower] = a.y < b.y ? [a, b] : [b, a];
          assert.ok(
            gap >= lower.size * 0.9 + upper.size * 0.12,
            `${format.id}: "${upper.value}" and "${lower.value}" are ${gap.toFixed(1)}px apart`,
          );
        }
      }
    }
  });

  test("a milestone in a month with no photographs still lands on the axis", () => {
    const named = [...renderSlide(slide, LIGHT, FORMATS[4]).walk()]
      .filter((node) => node.tag === "text")
      .map((node) => node.textContent);

    assert.ok(named.includes("+ FE 200-600mm G"), "the mark in an empty month was dropped");
  });
});

/**
 * Milestones annotate the slides that draw time, and a chart full of them is
 * where an annotation layer falls over: labels overlapping each other, a rule
 * outside the plot, a name running off the right edge. Twelve of them across a
 * two-year range is more than anyone has, which is the point.
 */
describe("a chart with milestones on it", () => {
  const marks = Array.from({ length: 12 }, (_, i) => ({
    day: 20250101 + i * 200,
    label: `+ FE ${100 + i * 10}-${300 + i * 10}mm F2.8 GM OSS II`,
    full: `Bought the FE ${100 + i * 10}-${300 + i * 10}mm F2.8 GM OSS II · 1 January 2025`,
  })).map((mark) => ({ ...mark, day: mark.day > 20251231 ? mark.day - 1200 + 10000 : mark.day }));

  const months = Array.from({ length: 24 }, (_, i) => 202501 + (i % 12) + Math.floor(i / 12) * 100);

  const annotated: Slide[] = [
    {
      kind: "stack",
      id: "timeline",
      title: "Gear over time",
      headline: "How your kit rotated",
      marks,
      months,
      series: [
        { label: "FE 200-600mm G", values: months.map((_, i) => 100 - i) },
        { label: "FE 24-70mm GM II", values: months.map((_, i) => 40 + i) },
      ],
      table: { columns: ["Month"], rows: [] },
    },
    {
      kind: "strip",
      id: "streaks",
      title: "Streaks",
      headline: "40 days in a row",
      marks,
      days: Array.from({ length: 400 }, (_, i) => ({ day: 20250101 + i, shots: i % 3 })),
      from: 20250101,
      to: 20261231,
      streak: { days: 40, from: 20250101, to: 20250209 },
      gap: { days: 12, from: 20250401, to: 20250413 },
      years: [
        { label: "2025", from: 20250101, to: 20251231 },
        { label: "2026", from: 20260101, to: 20261231 },
      ],
      layout: "packed",
      table: { columns: ["Day"], rows: [] },
    },
  ];

  for (const slide of annotated) {
    test(`${slide.id} keeps every mark inside the frame`, () => {
      for (const format of FORMATS) {
        for (const theme of [LIGHT, DARK]) {
          const svg = renderSlide(slide, theme, format);
          for (const node of svg.walk()) {
            if (node.tag === "svg") continue;
            const x = Number(node.attrs.get("x") ?? 0);
            const y = Number(node.attrs.get("y") ?? 0);
            const width = Number(node.attrs.get("width") ?? 0);
            const height = Number(node.attrs.get("height") ?? 0);
            assert.ok(Number.isFinite(x + y + width + height), `${format.id}: ${node.tag} has a NaN`);
            assert.ok(
              x >= -1 && x + width <= format.width + 1 && y >= -1 && y + height <= format.height + 1,
              `${format.id}/${slide.id}: a ${node.tag} left the frame at ${x},${y}`,
            );
          }
        }
      }
    });

    test(`${slide.id} never labels one mark on top of another`, () => {
      for (const format of FORMATS) {
        const texts = [...renderSlide(slide, LIGHT, format).walk()]
          .filter((node) => node.tag === "text" && node.textContent.trim() !== "")
          .map((node) => ({
            x: Number(node.attrs.get("x") ?? 0),
            y: Number(node.attrs.get("y") ?? 0),
            size: Number(node.attrs.get("font-size") ?? 16),
            width: measureShim(node.textContent, Number(node.attrs.get("font-size") ?? 16)),
            value: node.textContent,
          }));

        // Marks are the labels drawn on one line, so a pair of them sharing a
        // baseline must not share any of the space along it either.
        const row = texts.filter((t) => t.value.startsWith("+ FE "));
        for (let i = 0; i < row.length; i++) {
          for (let j = i + 1; j < row.length; j++) {
            const a = row[i]!;
            const b = row[j]!;
            if (Math.abs(a.y - b.y) > 1) continue;
            const [left, right] = a.x < b.x ? [a, b] : [b, a];
            assert.ok(
              left.x + left.width <= right.x,
              `${format.id}: "${left.value}" runs into "${right.value}"`,
            );
          }
        }
      }
    });
  }
});

/**
 * Culling is two cards and a card, not a chart, and the fixtures cannot reach
 * it: pick flags live in a Lightroom catalog and the library here is a folder.
 * So it is checked against a manufactured slide, in every shape — a thumb drawn
 * off the bottom of a story would be invisible rather than wrong-looking.
 */
describe("two verdicts and the pile nobody judged", () => {
  const verdict: Slide = {
    kind: "verdict",
    id: "culling",
    title: "Culling",
    subtitle: "Picks, rejects, and the ones you never went back to",
    headline: "You keep 1.4 frames for every one you throw out",
    note: "1,204 gone from the library since 18 August 2026, 890 of them rejects",
    cards: [
      { verdict: "up", label: "Picked", value: "27,527", note: "17% of your frames" },
      { verdict: "down", label: "Rejected", value: "19,147", note: "12% of your frames" },
    ],
    rest: { label: "Never flagged either way", value: "113,543", note: "71% of your frames" },
    table: { columns: ["Flag", "Photographs"], rows: [] },
  };

  test("both cards and the one under them stay inside the frame", () => {
    for (const format of FORMATS) {
      for (const theme of [LIGHT, DARK]) {
        const svg = renderSlide(verdict, theme, format);
        for (const node of svg.walk()) {
          if (node.tag === "svg") continue;
          const x = Number(node.attrs.get("x") ?? 0);
          const y = Number(node.attrs.get("y") ?? 0);
          const width = Number(node.attrs.get("width") ?? 0);
          const height = Number(node.attrs.get("height") ?? 0);
          assert.ok(Number.isFinite(x + y + width + height), `${format.id}: ${node.tag} has a NaN`);
          assert.ok(
            x >= -1 && x + width <= format.width + 1 && y >= -1 && y + height <= format.height + 1,
            `${format.id}: ${node.tag} left the frame at ${x},${y}`,
          );
        }
      }
    }
  });

  test("a thumb is drawn each way up, and neither is empty", () => {
    for (const format of FORMATS) {
      const svg = renderSlide(verdict, LIGHT, format);
      const paths = [...svg.walk()].filter((node) => node.tag === "path");
      assert.equal(paths.length, 2, `${format.id}: expected two thumbs`);

      // The same shape, turned over: whichever way up, every coordinate in it
      // has to be a real number, and the two cannot be identical.
      const [up, down] = paths.map((node) => node.attrs.get("d") ?? "");
      for (const d of [up, down]) {
        assert.ok(d && !/NaN/.test(d), `${format.id}: a thumb has a NaN in it`);
      }
      assert.notEqual(up, down, `${format.id}: both thumbs point the same way`);
    }
  });

  test("nothing on it sits on top of anything else", () => {
    for (const format of FORMATS) {
      const svg = renderSlide(verdict, LIGHT, format);
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
            `${format.id}: "${upper.value}" and "${lower.value}" are ${gap.toFixed(1)}px apart`,
          );
        }
      }
    }
  });

  test("every number on it is reachable as text", () => {
    const texts = [...renderSlide(verdict, LIGHT).walk()]
      .filter((node) => node.tag === "text")
      .map((node) => node.textContent);

    for (const value of ["27,527", "19,147", "113,543", "Picked", "Rejected"]) {
      assert.ok(
        texts.some((line) => line.includes(value)),
        `${value} is on no line of the slide`,
      );
    }
  });
});

/**
 * The keepers slide answers with a number the columns cannot hold — everything
 * that was never rated — and it has to survive every shape. It used to be
 * fitted into whatever room was left, which on the narrow formats was none.
 */
describe("a figure beside the chart", () => {
  const withFigure: Slide = {
    kind: "columns",
    id: "keepers",
    title: "Keepers",
    headline: "455 frames at four stars or better",
    items: [
      { label: "★", value: 1200 },
      { label: "★★", value: 800 },
      { label: "★★★", value: 400 },
      { label: "★★★★", value: 300 },
      { label: "★★★★★", value: 155 },
    ],
    highlight: 4,
    axisLabel: "Rating",
    figure: { value: "158,766", label: "never rated  ·  99%" },
    table: { columns: ["Rating", "Photographs"], rows: [] },
  };

  test("is drawn, in every shape, inside the frame", () => {
    for (const format of FORMATS) {
      const svg = renderSlide(withFigure, LIGHT, format);
      const texts = [...svg.walk()].filter((node) => node.tag === "text").map((n) => n.textContent);
      assert.ok(texts.includes("158,766"), `${format.id}: the figure was dropped`);

      for (const node of svg.walk()) {
        if (node.tag === "svg") continue;
        const x = Number(node.attrs.get("x") ?? 0);
        const y = Number(node.attrs.get("y") ?? 0);
        const width = Number(node.attrs.get("width") ?? 0);
        const height = Number(node.attrs.get("height") ?? 0);
        assert.ok(
          x >= -1 && x + width <= format.width + 1 && y >= -1 && y + height <= format.height + 1,
          `${format.id}: ${node.tag} left the frame`,
        );
      }
    }
  });
});
