import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Db } from "../src/core/db.ts";
import { defaultConfig, defaultSource, makeAnchor } from "../src/core/config.ts";
import { indexSource, indexOverview } from "../src/index/source.ts";
import { computeStats, gearCatalog } from "../src/stats/aggregate.ts";
import { buildDeck, type Slide } from "../src/stats/slides.ts";
import { resolveRange } from "../src/stats/range.ts";
import { makeFixtures, fixtureCatalog, fixtureNow } from "../tools/make-fixtures.ts";
import { makeCatalog } from "../tools/make-catalog.ts";
import { daysBetween } from "../src/core/time.ts";

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

  // And the catalog over the top of it, which is the only thing that carries a
  // rating or a pick flag — without it the keepers and culling slides are never
  // built, and their renderers were never under test.
  const catalog = path.join(root, "Fixtures.lrcat");
  await makeCatalog(catalog, fixtureCatalog(path.join(root, "library")));
  const catalogSource = defaultSource({ path: catalog, label: "Catalog" });
  config.sources.push(catalogSource);
  await indexSource(db, catalogSource, config);

  const overview = indexOverview(db);
  const range = resolveRange({ kind: "all" }, { firstDay: overview.firstDay, lastDay: overview.lastDay }, fixtureNow());

  // Milestones on days the fixtures actually hold, so every slide that draws
  // time is checked with its annotations on rather than without them.
  const first = overview.firstDay ?? 20250101;
  const last = overview.lastDay ?? 20251231;
  // A lens bought and later sold, taken from the fixtures rather than named,
  // so the kit history slide is drawn at all — and drawn with its longest row,
  // the one carrying a purchase, a sale and the span between them on one line.
  const lens = gearCatalog(db).lenses[0];

  const anchors = [
    makeAnchor("Bought the Nikon Z 8", first, [], {
      kind: "bought",
      gear: { dimension: "camera", key: "nikonz8" },
    }),
    ...(lens
      ? [
          makeAnchor(`Bought the ${lens.label}`, first, [], {
            kind: "bought",
            gear: { dimension: "lens", key: lens.key },
          }),
          makeAnchor(`Sold the ${lens.label}`, last, [], {
            kind: "sold",
            gear: { dimension: "lens", key: lens.key },
          }),
        ]
      : []),
    makeAnchor("Moved to Lisbon", last, []),
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

    // By id as well as by kind, for the slides whose fixtures are easy to
    // break: kit history needs two gear milestones to exist at all, so a
    // change to the anchors above can silently stop it being drawn.
    //
    // #culling and #keepers need the catalog above for the same reason: a
    // folder carries no rating and no pick flag, so without it neither slide
    // exists to be drawn.
    const ids = new Set(slides.map((slide) => slide.id));
    for (const id of ["kit", "culling", "keepers"]) {
      assert.ok(ids.has(id), `no #${id} slide in the deck`);
    }

    // And the row that is only there when one lens was both the first bought
    // and the first sold — the longest line this deck writes.
    const kit = slides.find((slide) => slide.id === "kit");
    assert.ok(
      kit?.kind === "list" &&
        kit.items.some((item) => item.meta.includes("and the first you sold")),
      "the kit slide is not being drawn with its merged row",
    );
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
          // A polygon has no x or y — its geometry is a flat list of pairs, and
          // without this a drawn glyph could land anywhere at all and nothing
          // here would notice.
          // Space-separated pairs, which is what `star()` writes — deliberately
          // not a whitespace pattern, so nothing here depends on an escape.
          for (const pair of (node.attrs.get("points") ?? "").split(" ").filter(Boolean)) {
            const [px = NaN, py = NaN] = pair.split(",").map(Number);
            assert.ok(
              Number.isFinite(px) && px >= -1 && px <= format.width + 1,
              `${format.id}: ${node.tag} point off the side (${px})`,
            );
            assert.ok(
              Number.isFinite(py) && py >= -1 && py <= format.height + 1,
              `${format.id}: ${node.tag} point off the bottom (${py})`,
            );
          }

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

  /**
   * The picker beside a slide offers the colours *that slide* is drawn in, and
   * it finds them by reading the fills and strokes back off the drawing — no
   * table of which slide uses which role, which would be a second source of
   * truth. That only works while the palette is written on as attributes, which
   * it has to be anyway: export rasterises through an `<img>`, where anything
   * inherited from the page is gone. A move to classes or inline styles would
   * empty the panel silently, so it is asserted here rather than noticed later.
   */
  test("the palette is readable back off the drawing", () => {
    const series0 = (LIGHT as { series: string[] }).series[0]?.toLowerCase();
    let found = 0;

    for (const slide of slides) {
      const drawn = new Set<string>();
      for (const node of renderSlide(slide, LIGHT, FORMATS[0]!).walk()) {
        for (const name of ["fill", "stroke"]) {
          const value = node.attrs.get(name)?.toLowerCase();
          if (value?.startsWith("#")) drawn.add(value);
        }
        // A colour reachable only through a class or a style attribute is a
        // colour the picker cannot offer and the PNG will not carry.
        assert.equal(node.attrs.get("class"), undefined, `${slide.id}: ${node.tag} carries a class`);
        assert.equal(node.attrs.get("style"), undefined, `${slide.id}: ${node.tag} carries a style`);
      }
      if (drawn.has(series0 ?? "")) found += 1;
    }

    assert.ok(found > 3, `only ${found} slides draw in the main colour`);
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

  /**
   * The unit of this layout is the month, so a trip that crosses one and is
   * drawn as a single rule says the wrong thing — it reads as a date. The band
   * has to cover the rows it actually spans, which is what is asserted here
   * rather than a height in pixels: the rows are sized off the frame.
   */
  test("a trip that crosses months covers the rows it crosses", () => {
    const spanning: Slide = {
      ...slide,
      marks: [
        ...(slide.marks ?? []),
        {
          day: 20240210,
          until: 20240405,
          label: "Two months away",
          full: "Two months away · 10 Feb 2024 to 5 Apr 2024 · 45 photographs",
        },
      ],
    };

    for (const format of FORMATS) {
      const rects: ShimNode[] = [...renderSlide(spanning, LIGHT, format).walk()].filter((node) => node.tag === "rect");
      const bands = rects.filter((node) => Number(node.attrs.get("opacity")) === 0.09);
      assert.equal(bands.length, 1, `${format.id}: expected one band, got ${bands.length}`);

      const band = bands[0]!;
      const from = Number(band.attrs.get("y"));
      const to = from + Number(band.attrs.get("height"));
      assert.ok(to > from, `${format.id}: the band has no height`);

      // The bars are the only thing drawn in the series colour, and one of them
      // is one month. Three months are spanned; two inside the band is enough
      // to prove it is a band rather than a rule that grew a pixel.
      const covered = rects
        .filter((node) => node.attrs.get("fill") === (LIGHT as { series: string[] }).series[0])
        .filter((node) => Number(node.attrs.get("y")) >= from - 1 && Number(node.attrs.get("y")) <= to + 1);

      assert.ok(covered.length >= 2, `${format.id}: the band covers ${covered.length} months`);
    }
  });

  test("a trip that began before the first month is still drawn", () => {
    // Milestones are chosen by overlapping the range, so this is a trip the
    // deck is genuinely partly about — and both layouts used to drop it whole
    // for having no row or column to start in.
    const early: Slide = {
      ...slide,
      marks: [{ day: 20180101, until: 20190310, label: "A long way round", full: "A long way round" }],
    };

    for (const orientation of ["rows", "columns"] as const) {
      const named = [...renderSlide({ ...early, orientation }, LIGHT, FORMATS[4]!).walk()]
        .filter((node) => node.tag === "text")
        .map((node) => node.textContent);

      assert.ok(named.includes("A long way round"), `${orientation}: the trip was dropped`);
    }
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
      { glyph: { kind: "thumb", up: true }, label: "Picked", value: "27,527", note: "17% of your frames" },
      { glyph: { kind: "thumb", up: false }, label: "Rejected", value: "19,147", note: "12% of your frames" },
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
          // A polygon has no x or y — its geometry is a flat list of pairs, and
          // without this a drawn glyph could land anywhere at all and nothing
          // here would notice.
          // Space-separated pairs, which is what `star()` writes — deliberately
          // not a whitespace pattern, so nothing here depends on an escape.
          for (const pair of (node.attrs.get("points") ?? "").split(" ").filter(Boolean)) {
            const [px = NaN, py = NaN] = pair.split(",").map(Number);
            assert.ok(
              Number.isFinite(px) && px >= -1 && px <= format.width + 1,
              `${format.id}: ${node.tag} point off the side (${px})`,
            );
            assert.ok(
              Number.isFinite(py) && py >= -1 && py <= format.height + 1,
              `${format.id}: ${node.tag} point off the bottom (${py})`,
            );
          }

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
describe("the wall as a calendar", () => {
  /** The real streaks slide, laid out a block per month. */
  const asMonths = (): Slide => {
    const streaks = slides.find((slide) => slide.id === "streaks");
    assert.ok(streaks && streaks.kind === "strip", "no streaks slide to lay out");
    return { ...streaks, layout: "months" };
  };

  /** Every day square that carries a count, as `{ day, x, y }`. */
  const squares = (svg: ShimNode) => {
    const found: Array<{ day: number; x: number; y: number }> = [];
    for (const node of svg.walk()) {
      if (node.tag !== "rect") continue;
      const title = node.children.find((child) => child.tag === "title");
      // Split rather than matched: the title is "5 Apr 2025 — 12", and a
      // pattern is one escape away from silently matching nothing.
      const [date, month, year, dash] = (title?.textContent ?? "").split(" ");
      if (dash !== "—" || !MONTHS.includes(month as string)) continue;
      found.push({
        day: Number(year) * 10000 + (MONTHS.indexOf(month as string) + 1) * 100 + Number(date),
        x: Number(node.attrs.get("x")),
        y: Number(node.attrs.get("y")),
      });
    }
    return found;
  };

  test("draws every day in the range exactly once, and none outside it", () => {
    const slide = asMonths();
    assert.ok(slide.kind === "strip");
    const drawn = squares(renderSlide(slide, LIGHT));

    const days = new Set(drawn.map((square) => square.day));
    assert.equal(days.size, drawn.length, "a day was drawn twice");
    assert.ok(days.has(slide.from), "the first day of the range is missing");
    assert.ok(days.has(slide.to), "the last day of the range is missing");

    for (const day of days) {
      assert.ok(day >= slide.from && day <= slide.to, `${day} is outside the range`);
    }
    // Whole months in the middle are whole: the count is the span itself.
    assert.equal(days.size, daysBetween(slide.from, slide.to) + 1);
  });

  test("a column is a weekday, all the way down the block", () => {
    // What the layout is for. Inside one month, every Monday shares one x, and
    // the seven weekdays take seven columns — that is the whole difference
    // between this and the packed wall.
    const drawn = squares(renderSlide(asMonths(), LIGHT));
    const columns = new Map<string, Set<number>>();

    for (const square of drawn) {
      const year = Math.floor(square.day / 10000);
      const month = Math.floor(square.day / 100) % 100;
      const date = new Date(Date.UTC(year, month - 1, square.day % 100));
      const key = `${year}-${month}-${(date.getUTCDay() + 6) % 7}`;
      if (!columns.has(key)) columns.set(key, new Set());
      (columns.get(key) as Set<number>).add(square.x);
    }

    assert.ok(columns.size > 7, `only ${columns.size} weekday columns across the whole range`);
    for (const [key, xs] of columns) {
      assert.equal(xs.size, 1, `${key} landed on ${xs.size} different columns`);
    }
  });

  test("stays inside the frame, in every shape and both themes", () => {
    for (const format of FORMATS) {
      for (const theme of [LIGHT, DARK]) {
        const svg = renderSlide(asMonths(), theme, format);
        for (const node of svg.walk()) {
          if (node.tag === "svg") continue;
          for (const [key, value] of node.attrs) {
            if (!NUMERIC_ATTRS.has(key)) continue;
            assert.ok(Number.isFinite(Number(value)), `${format.id}: ${node.tag}.${key} is "${value}"`);
          }
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
    }
  });
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Every bar chart draws both ways round now, and the flipped half is the half
 * nobody looks at: a label gutter that eats the plot, a value written off the
 * right edge, seven day names in a frame built for three letters. So both are
 * checked, in every shape, for every slide that offers the choice.
 */
describe("bars either way round", () => {
  const both: Slide[] = [
    {
      kind: "bars",
      id: "lenses",
      title: "Lenses",
      headline: "FE 200-600 G — 46% of your frames",
      items: Array.from({ length: 8 }, (_, i) => ({
        label: `FE ${100 + i * 10}-${300 + i * 10}mm F2.8 GM OSS II`,
        value: 900 - i * 90,
        valueLabel: `${900 - i * 90}  ·  ${40 - i * 3}%`,
        share: 0.4 - i * 0.03,
      })),
      table: { columns: ["Lens"], rows: [] },
    },
    {
      kind: "columns",
      id: "shutter",
      title: "Shutter speed",
      headline: "1/500 is where you live",
      items: ["30s", "1s", "1/15", "1/60", "1/250", "1/500", "1/2000", "1/8000"].map((label, i) => ({
        label,
        value: (i + 1) * 120,
      })),
      highlight: 5,
      axisLabel: "Shutter",
      table: { columns: ["Shutter"], rows: [] },
    },
    {
      kind: "week",
      id: "week",
      title: "Day of the week",
      headline: "Saturday is your day",
      days: [120, 90, 140, 80, 300, 620, 410],
      labels: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      weekend: [5, 6],
      table: { columns: ["Day"], rows: [] },
    },
    {
      kind: "months",
      id: "calendar",
      title: "Month by month",
      headline: "22 Feb 2025 — 10,061 photographs in one day",
      months: Array.from({ length: 26 }, (_, i) => ({
        ym: 202401 + (i % 12) + Math.floor(i / 12) * 100,
        shots: 100 + i * 40,
      })),
      marks: [{ day: 20240917, label: "+ a9 III", full: "Bought the a9 III · 17 September 2024" }],
      table: { columns: ["Month"], rows: [] },
    },
  ];

  for (const slide of both) {
    for (const orientation of ["rows", "columns"] as const) {
      const turned = { ...slide, orientation } as Slide;

      test(`${slide.id} as ${orientation} stays inside the frame`, () => {
        for (const format of FORMATS) {
          for (const theme of [LIGHT, DARK]) {
            for (const node of renderSlide(turned, theme, format).walk()) {
              if (node.tag === "svg") continue;
              const x = Number(node.attrs.get("x") ?? 0);
              const y = Number(node.attrs.get("y") ?? 0);
              const width = Number(node.attrs.get("width") ?? 0);
              const height = Number(node.attrs.get("height") ?? 0);
              assert.ok(Number.isFinite(x + y + width + height), `${format.id}: ${node.tag} has a NaN`);
              assert.ok(
                x >= -1 && x + width <= format.width + 1 && y >= -1 && y + height <= format.height + 1,
                `${format.id}/${slide.id}/${orientation}: a ${node.tag} left the frame at ${x},${y}`,
              );
            }
          }
        }
      });

      test(`${slide.id} as ${orientation} keeps its labels apart`, () => {
        for (const format of FORMATS) {
          const texts = [...renderSlide(turned, LIGHT, format).walk()]
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
                `${format.id}/${slide.id}/${orientation}: "${upper.value}" and "${lower.value}" are ${gap.toFixed(1)}px apart`,
              );
            }
          }
        }
      });

      test(`${slide.id} as ${orientation} says what every mark is`, () => {
        const titles = [...renderSlide(turned, LIGHT).walk()].filter((node) => node.tag === "title");
        assert.ok(titles.length > 0, `${slide.id}/${orientation} has no hover labels`);
      });
    }
  }
});

/**
 * The ground a slide is drawn on.
 *
 * Decoration, and therefore held to the same bar as everything else: no NaN, no
 * shape outside the frame, and above all *repeatable* — the same deck is drawn
 * on screen, again in the contact sheet, and again into a PNG and a PDF, and a
 * backdrop that differed between those would be three pictures of one slide.
 */
describe("what the slide is drawn on", () => {
  const KINDS = ["blobs", "rings", "grain"];
  const on = (kind: string, seed = 3) => ({ ...(LIGHT as object), backdrop: { kind, seed } });

  test("stays inside the frame and out of the numbers, in every shape", () => {
    for (const kind of KINDS) {
      for (const format of FORMATS) {
        for (const slide of slides) {
          for (const node of renderSlide(slide, on(kind), format).walk()) {
            if (node.tag === "svg") continue;
            const numbers = ["x", "y", "width", "height", "cx", "cy", "r"].map((key) =>
              Number(node.attrs.get(key) ?? 0),
            );
            assert.ok(
              numbers.every((value) => Number.isFinite(value)),
              `${kind}/${format.id}/${slide.id}: ${node.tag} has a NaN`,
            );
          }
        }
      }
    }
  });

  test("the same slide comes back the same, and a shuffle changes it", () => {
    const draw = (theme: unknown) =>
      [...renderSlide(slides[0]!, theme, FORMATS[0]!).walk()]
        .map((node) => `${node.tag}:${[...node.attrs].join(",")}`)
        .join("|");

    for (const kind of KINDS) {
      assert.equal(draw(on(kind, 3)), draw(on(kind, 3)), `${kind} is not repeatable`);
      assert.notEqual(draw(on(kind, 3)), draw(on(kind, 4)), `${kind} ignores the shuffle`);
    }
  });

  test("two slides are not the same picture", () => {
    // Keyed on the slide's own id, so a deck is a deck rather than one shape
    // printed twenty times.
    const shapes = (slide: Slide) =>
      [...renderSlide(slide, on("blobs"), FORMATS[0]!).walk()]
        .filter((node) => node.tag === "circle")
        .map((node) => `${node.attrs.get("cx")},${node.attrs.get("cy")},${node.attrs.get("r")}`)
        .join("|");

    assert.notEqual(shapes(slides[0]!), shapes(slides[1]!));
  });

  test("it is never mistaken for data", () => {
    // `coloursIn` in deck.js skips this group, which is what keeps a backdrop
    // from putting a well in "Colours here" for a colour no chart uses.
    for (const kind of KINDS) {
      const root = renderSlide(slides[0]!, on(kind), FORMATS[0]!);
      const layers = [...root.walk()].filter((node) => node.attrs.has("data-backdrop"));
      assert.equal(layers.length, 1, `${kind}: expected one backdrop layer, got ${layers.length}`);
      assert.ok((layers[0]?.children.length ?? 0) > 0, `${kind}: the layer is empty`);
    }
  });

  test("a flat backdrop draws exactly what no backdrop draws", () => {
    // The default has to stay the default: a config that has never heard of
    // this must render byte for byte what it rendered before.
    const plain = [...renderSlide(slides[0]!, LIGHT, FORMATS[0]!).walk()].length;
    const flat = [...renderSlide(slides[0]!, on("flat"), FORMATS[0]!).walk()].length;
    assert.equal(flat, plain);
  });
});

/**
 * How a panel is drawn, which is five answers to one question.
 *
 * Culling, keepers, the three figures beside each year and the ground under the
 * map are all the same object — a box with something in it — and every style
 * has to survive every one of them in every shape. The bar is the bar the rest
 * of this file sets: no NaN, nothing outside the frame, and no `class` or
 * `style`, because a rasterised SVG is rendered with no page around it.
 */
describe("how a card is drawn", () => {
  const STYLES = ["glass", "soft", "outline", "tinted", "flat"];
  const styled = (id: string) => ({ ...(LIGHT as object), cardStyle: id });
  const boxed = () => slides.filter((slide) => ["verdict", "years", "map"].includes(slide.kind));

  test("finds the slides it is meant to be checking", () => {
    // A sweep that quietly matched nothing would pass for ever — and the map is
    // the one that would go unnoticed, since its card is the ground under the
    // points rather than anything that looks like a card.
    const kinds = new Set(boxed().map((slide) => slide.kind));
    for (const kind of ["verdict", "map"]) {
      assert.ok(kinds.has(kind as Slide["kind"]), `the sweep no longer sees a ${kind} slide`);
    }
  });

  test("every style stays inside the frame, in every shape", () => {
    for (const style of STYLES) {
      for (const format of FORMATS) {
        for (const slide of boxed()) {
          for (const node of renderSlide(slide, styled(style), format).walk()) {
            if (node.tag === "svg") continue;
            const x = Number(node.attrs.get("x") ?? 0);
            const y = Number(node.attrs.get("y") ?? 0);
            const width = Number(node.attrs.get("width") ?? 0);
            const height = Number(node.attrs.get("height") ?? 0);
            const where = `${style}/${format.id}/${slide.id}: ${node.tag}`;

            assert.ok(Number.isFinite(x + y + width + height), `${where} has a NaN`);
            assert.ok(width >= 0 && height >= 0, `${where} has a negative size`);
            assert.ok(
              x >= -1 && x + width <= format.width + 1 && y >= -1 && y + height <= format.height + 1,
              `${where} left the frame`,
            );
          }
        }
      }
    }
  });

  /**
   * A filter region written as a percentage would land in `x` as "-25%", which
   * `Number` reads as NaN — and the frame check above would then be measuring
   * nothing at all on that element. The soft style leans on the default region
   * rather than setting one, and this is what keeps it that way.
   */
  test("nothing measures itself in percentages", () => {
    for (const style of STYLES) {
      for (const node of renderSlide(boxed()[0]!, styled(style)).walk()) {
        for (const key of ["x", "y", "width", "height"]) {
          const raw = node.attrs.get(key);
          assert.ok(raw === undefined || !raw.includes("%"), `${style}: ${node.tag} ${key}="${raw}"`);
        }
      }
    }
  });

  test("the palette is still readable back off the drawing", () => {
    for (const style of STYLES) {
      for (const node of renderSlide(boxed()[0]!, styled(style)).walk()) {
        assert.equal(node.attrs.get("class"), undefined, `${style}: ${node.tag} carries a class`);
        assert.equal(node.attrs.get("style"), undefined, `${style}: ${node.tag} carries a style`);
      }
    }
  });

  /**
   * The contact sheet puts every slide in one document, so two `url(#card)`
   * would both find the first definition — which is how a dark card ends up
   * painted with a light slide's gradient.
   */
  test("no two slides define the same id", () => {
    for (const style of STYLES) {
      const seen = new Set<string>();
      for (const slide of boxed()) {
        for (const node of renderSlide(slide, styled(style)).walk()) {
          const id = node.attrs.get("id");
          if (id === undefined) continue;
          assert.ok(!seen.has(id), `${style}: two slides both define #${id}`);
          seen.add(id);
        }
      }
    }
  });

  test("an unknown style falls back rather than drawing nothing", () => {
    const shape = (theme: unknown) =>
      [...renderSlide(boxed()[0]!, theme).walk()].map((node) => node.tag).join(",");

    assert.equal(shape(styled("nonsense")), shape(styled("glass")));
    assert.equal(shape({ ...(LIGHT as object) }), shape(styled("glass")));
  });
});
