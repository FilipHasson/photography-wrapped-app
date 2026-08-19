import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildDeck, type Slide } from "../src/stats/slides.ts";
import type { DeckStats, Tally } from "../src/stats/aggregate.ts";
import { resolveRange } from "../src/stats/range.ts";

/**
 * What a slide says, checked without a database behind it.
 *
 * The rule these cover: a chart may fold a long tail into one bar, but the
 * table behind it lists every row — including the ones currently hidden, which
 * have to be visible to be brought back.
 */

function tally(label: string, shots: number, excluded = false): Tally {
  return {
    key: label.toLowerCase().replace(/\W+/g, ""),
    label,
    shots,
    share: 0,
    firstDay: 20250101,
    lastDay: 20251231,
    excluded,
  };
}

/** A believable-enough stats object; only the fields under test are populated. */
function statsWith(overrides: Partial<DeckStats>): DeckStats {
  const range = resolveRange({ kind: "year", year: 2025 }, { firstDay: null, lastDay: null });
  const empty = { buckets: [], known: 0, favourite: null, median: null };

  return {
    range,
    totals: {
      shots: 100, files: 100, stills: 100, videos: 0, raws: 60, jpegs: 40, bytes: 1024,
      videoSeconds: 0, daysShot: 20, daysInRange: 365, cameras: 2, lenses: 3, bodies: 1,
      firstDay: 20250101, lastDay: 20251231, withGps: 0, withFlash: 0, rated: 0, keepers: 0,
      previousShots: null,
    },
    cameras: [], lenses: [], combos: [], hiddenCameras: [], hiddenLenses: [],
    focal: empty, focalClasses: [], aperture: empty, iso: empty, shutter: empty,
    hours: new Array(24).fill(0), weekdays: new Array(7).fill(0),
    daily: [], monthly: [], timeline: { months: [], series: [] },
    ratings: new Array(6).fill(0),
    orientation: { landscape: 0, portrait: 0, square: 0 },
    busiestDay: null, longestStreak: null, longestGap: null,
    places: [], placesKnown: 0, debuts: [], burst: null,
    ...overrides,
  };
}

const findSlide = (slides: Slide[], id: string) => slides.find((slide) => slide.id === id);

describe("the numbers behind a slide", () => {
  const many = Array.from({ length: 20 }, (_, i) => tally(`Lens ${i + 1}`, 100 - i * 3));

  test("the chart folds the tail away", () => {
    const slide = findSlide(buildDeck(statsWith({ lenses: many })).slides, "lenses");
    assert.ok(slide && slide.kind === "bars");

    // Eight leaders plus one pooled bar; past that it is a wall, not a chart.
    assert.equal(slide.items.length, 9);
    assert.equal(slide.items[8]?.label, "12 others");
    assert.equal(slide.items[8]?.muted, true);
    // The pooled bar is worth what the twelve are worth together.
    const pooled = many.slice(8).reduce((sum, row) => sum + row.shots, 0);
    assert.equal(slide.items[8]?.value, pooled);
  });

  test("the table does not", () => {
    const slide = findSlide(buildDeck(statsWith({ lenses: many })).slides, "lenses");
    assert.ok(slide);

    assert.equal(slide.table.rows.length, 20, "every lens should be listed");
    for (const row of slide.table.rows) {
      assert.ok(!/^\d+ others$/.test(String(row[0])), `"${row[0]}" is a summary, not a lens`);
    }
    assert.deepEqual(slide.table.rows.at(-1)?.[0], "Lens 20");
  });

  test("hidden gear is listed, marked, and carries its key", () => {
    const deck = buildDeck(
      statsWith({
        cameras: [tally("Nikon Z 8", 900)],
        hiddenCameras: [tally("Apple iPhone 15 Pro", 1, true)],
      }),
    );
    const slide = findSlide(deck.slides, "cameras");
    assert.ok(slide && slide.kind === "bars");

    // Not drawn…
    assert.equal(slide.items.length, 1);
    // …but listed, so it can be brought back.
    assert.equal(slide.table.rows.length, 2);
    assert.equal(slide.table.rows[1]?.[0], "Apple iPhone 15 Pro");
    assert.equal(slide.table.rows[1]?.[2], "hidden");

    const keys = slide.table.rowKeys ?? [];
    assert.equal(keys[0]?.dimension, "camera");
    assert.equal(keys[0]?.excluded, false);
    assert.equal(keys[1]?.excluded, true);
    assert.ok(slide.note?.includes("iPhone"), slide.note);
  });

  test("rows that are not gear carry no key", () => {
    const deck = buildDeck(statsWith({ cameras: [tally("Nikon Z 8", 100)], lenses: [tally("50mm", 100)] }));
    const combos = findSlide(deck.slides, "combos");
    // A pairing is two things at once; hiding one of them is the camera's row
    // or the lens's row, never the pair's.
    assert.equal(combos, undefined, "no pairings in this stats object");

    const opening = findSlide(deck.slides, "opening");
    assert.equal(opening?.table.rowKeys, undefined);
  });
});

describe("keepers", () => {
  test("the frames nobody ever rated get their own figure", () => {
    const ratings = [0, 10, 20, 30, 8, 2];
    const deck = buildDeck(statsWith({ ratings, totals: { ...statsWith({}).totals, shots: 500, rated: 70 } }));
    const slide = findSlide(deck.slides, "keepers");
    assert.ok(slide && slide.kind === "columns");

    // 500 photographs, 70 of them rated: the other 430 are the story, and a
    // sixth column would flatten the five that are being compared.
    assert.equal(slide.figure?.value, "430");
    assert.ok(slide.figure?.label.includes("never rated"));
    assert.equal(slide.items.length, 5);
    assert.deepEqual(slide.table.rows.at(-1), ["Never rated", 430]);
  });
});

describe("what the opening slide owns up to", () => {
  test("says when a start date is holding the range back", () => {
    const range = resolveRange(
      { kind: "all" },
      { firstDay: 20180101, lastDay: 20251231, floorDay: 20230824 },
    );
    const deck = buildDeck(statsWith({ range }));
    const opening = findSlide(deck.slides, "opening");

    assert.ok(range.clipped);
    assert.ok(opening?.note?.includes("24 Aug 2023"), opening?.note);
  });

  test("says how much gear is hidden", () => {
    const deck = buildDeck(
      statsWith({
        cameras: [tally("Nikon Z 8", 100)],
        hiddenCameras: [tally("iPhone", 1, true)],
        hiddenLenses: [tally("Unknown", 2, true)],
      }),
    );
    // Footnotes are a phrase now, not a sentence — the count is still there.
    assert.ok(findSlide(deck.slides, "opening")?.note?.includes("2 hidden"));
  });
});
