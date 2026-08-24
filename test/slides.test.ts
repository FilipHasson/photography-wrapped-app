import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildDeck, fmtSpan, type Slide } from "../src/stats/slides.ts";
import {
  resolveLimits,
  resolveMarks,
  resolveKit,
  resolveTypes,
  type KitToggles,
  type DeckStats,
  type Milestone,
  type Tally,
} from "../src/stats/aggregate.ts";
import { resolveRange } from "../src/stats/range.ts";

/**
 * What a slide says, checked without a database behind it.
 *
 * The rule these cover: a chart may fold a long tail into one bar, but the
 * table behind it lists every row — including the ones currently hidden, which
 * have to be visible to be brought back.
 */

/**
 * A fixed clock. An unbounded range runs to today, so a test that resolves one
 * without saying when "now" is drifts by a day every day.
 */
const NOW = new Date(2026, 6, 1);

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
      previousShots: null, deletedBefore: 0,
    },
    cameras: [], lenses: [], combos: [], hiddenCameras: [], hiddenLenses: [],
    focal: empty, focalClasses: [], aperture: empty, iso: empty, shutter: empty,
    hours: new Array(24).fill(0), weekdays: new Array(7).fill(0),
    daily: [], monthly: [], timeline: { months: [], series: [] },
    ratings: new Array(6).fill(0),
    orientation: { landscape: 0, portrait: 0, square: 0 },
    busiestDay: null, longestStreak: null, longestGap: null,
    places: [], placesKnown: 0, debuts: [], milestones: [], burst: null,
    years: [], yearBasis: "anchor", location: null, home: null,
    weekStart: "mon", markWeekend: false, showMarks: resolveMarks(), showTypes: resolveTypes(), kit: resolveKit(), layout: {}, wall: "packed",
    culling: { picked: 0, rejected: 0, unflagged: 0, removed: 0, removedRejected: 0, watchingSince: null, deletedBefore: 0 },
    daylight: { mode: "06-18", sunrise: 6, sunset: 18, source: "06:00 to 18:00" },
    daylightHours: { sunrise: 6, sunset: 18 },
    limits: resolveLimits(),
    ...overrides,
  };
}

const findSlide = (slides: Slide[], id: string) => slides.find((slide) => slide.id === id);

const YEARS = [
  { label: "2023–24", from: 20230824, to: 20240823, shots: 10621, cameras: 1, lenses: 6, partial: false, remaining: 0 },
  { label: "2024–25", from: 20240824, to: 20250823, shots: 97962, cameras: 3, lenses: 8, partial: false, remaining: 0 },
  { label: "2025–26", from: 20250824, to: 20260816, shots: 51156, cameras: 3, lenses: 8, partial: true, remaining: 7 },
];

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
    // The slide itself says nothing about it: what has been hidden is a fact
    // about the reader's settings, not about their photography.
    assert.equal(slide.note, undefined);
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

describe("year by year", () => {
  const years = YEARS;

  test("three numbers a year, and the busiest one named", () => {
    const slide = findSlide(buildDeck(statsWith({ years })).slides, "years");
    assert.ok(slide && slide.kind === "years");
    assert.equal(slide.years.length, 3);
    assert.ok(slide.headline.includes("2024–25"), slide.headline);
    // How much of the running year is left, rather than only that it is.
    assert.equal(slide.note, "7 days left in 2025–26");
  });

  test("carries the choice of what a year is", () => {
    const slide = findSlide(buildDeck(statsWith({ years })).slides, "years");
    const setting = slide?.settings?.[0];
    assert.equal(setting?.id, "yearBasis");
    assert.equal(setting?.value, "anchor");
    assert.deepEqual(setting?.options.map((option) => option.value), ["anchor", "calendar"]);
  });

  test("the table gives the boundaries the cards imply", () => {
    const slide = findSlide(buildDeck(statsWith({ years })).slides, "years");
    assert.deepEqual(slide?.table.columns, ["Year", "From", "To", "Photographs", "Cameras", "Lenses"]);
    assert.deepEqual(slide?.table.rows[0], ["2023–24", "24 Aug 2023", "23 Aug 2024", 10621, 1, 6]);
  });

  test("one year is not a comparison", () => {
    // With a single year the opening slide already says all of this.
    assert.equal(findSlide(buildDeck(statsWith({ years: years.slice(0, 1) })).slides, "years"), undefined);
    assert.equal(findSlide(buildDeck(statsWith({ years: [] })).slides, "years"), undefined);
  });
});

describe("keepers", () => {
  // Nothing at two stars, which is the case a card has to survive: a rating
  // nobody used is a gap in the scale, and a scale that closes its own gaps up
  // is lying about the shape of the edit.
  const RATINGS = [0, 10, 0, 30, 8, 2];
  const keepers = (ratings = RATINGS, shots = 500) =>
    findSlide(
      buildDeck(statsWith({ ratings, totals: { ...statsWith({}).totals, shots, rated: 50 } })).slides,
      "keepers",
    );

  test("is a card per rating, with the stars on it", () => {
    const slide = keepers();
    assert.ok(slide && slide.kind === "verdict");

    assert.deepEqual(
      slide.cards.map((card) => card.glyph),
      [1, 2, 3, 4, 5].map((count) => ({ kind: "stars", count })),
    );
    assert.deepEqual(
      slide.cards.map((card) => card.value),
      ["10", "0", "30", "8", "2"],
    );
    // Named as well as drawn: four small stars and five small stars are hard
    // to tell apart, and this is what the hover and the table say.
    assert.deepEqual(slide.cards[0]?.label, "1 star");
    assert.deepEqual(slide.cards[4]?.label, "5 stars");
  });

  test("divides by what was rated, and says which denominator it used", () => {
    const slide = keepers();
    assert.ok(slide && slide.kind === "verdict");

    // 50 rated frames, 30 of them at three stars.
    assert.equal(slide.cards[2]?.note, "60% of rated");
    // The card underneath cannot use that denominator, and does not pretend to.
    assert.equal(slide.rest.value, "450");
    assert.equal(slide.rest.note, "90% of everything you shot");
    assert.deepEqual(slide.table.rows.at(-1), ["Never rated", 450, "—"]);
  });

  test("the headline says something no card already says", () => {
    // The four- and five-star cards carry their own counts now, so the old
    // headline would have been the same number twice.
    const slide = keepers();
    assert.equal(slide?.headline, "You rate about one frame in 10");
    assert.ok(slide?.note?.startsWith("20% of what you rated is four stars or better"));
  });

  test("a library that rates everything is not divided by nothing", () => {
    const slide = keepers([0, 10, 0, 30, 8, 2], 50);
    assert.equal(slide?.headline, "You rate almost everything you shoot");
    assert.ok(slide && slide.kind === "verdict" && slide.rest.value === "0");
  });
});

describe("what the opening slide owns up to", () => {
  test("says when a start date is holding the range back", () => {
    const range = resolveRange(
      { kind: "all" },
      { firstDay: 20180101, lastDay: 20251231, floorDay: 20230824 },
      NOW,
    );
    const deck = buildDeck(statsWith({ range }));
    const opening = findSlide(deck.slides, "opening");

    assert.ok(range.clipped);
    // The date is in the subtitle; the note says what that date *is*, because
    // "All time" starting years after the first photograph needs explaining.
    assert.ok(opening?.note?.includes("start date"), opening?.note);
    assert.ok(opening?.subtitle?.startsWith("24 Aug 2023 — "), opening?.subtitle);
  });

  test("the period is the range, not the frames inside it", () => {
    // The bug this exists for: an all-time deck that runs to today said the
    // day of the last frame, while the tile beside it counted days to today.
    // The stub's frames run 1 Jan to 31 Dec 2025; the period is wider at both
    // ends, which is what an unbounded range running to today looks like.
    const range = resolveRange({ kind: "custom", from: 20241201, to: 20260101 }, {
      firstDay: 20250101,
      lastDay: 20251231,
    });
    const opening = findSlide(buildDeck(statsWith({ range })).slides, "opening");

    assert.ok(opening?.subtitle?.startsWith("1 Dec 2024 — 1 Jan 2026"), opening?.subtitle);
    // Not lost, only moved: the frames themselves are rows in the table.
    const rows = opening?.table?.rows.map((row) => row.join(" = "));
    assert.ok(rows?.includes("First frame = 1 Jan 2025"), JSON.stringify(rows));
    assert.ok(rows?.includes("Last frame = 31 Dec 2025"), JSON.stringify(rows));
  });

  test("never mentions what is hidden, or counts files at anyone", () => {
    const deck = buildDeck(
      statsWith({
        cameras: [tally("Nikon Z 8", 100)],
        hiddenCameras: [tally("iPhone", 1, true)],
        hiddenLenses: [tally("Unknown", 2, true)],
      }),
    );
    assert.equal(findSlide(deck.slides, "opening")?.note, undefined);
  });

  /**
   * The footnote rule, enforced rather than remembered: no slide ends with a
   * count of frames, files or photographs, and none of them mentions hidden
   * gear. Both were noise on every slide that had them, and both are in the
   * table view, which is where a denominator belongs.
   */
  test("no slide footnotes a count of frames, or anything hidden", () => {
    const deck = buildDeck(
      statsWith({
        cameras: [tally("Nikon Z 8", 900), tally("iPhone", 4)],
        lenses: Array.from({ length: 20 }, (_, i) => tally(`Lens ${i + 1}`, 100 - i * 3)),
        combos: Array.from({ length: 12 }, (_, i) => tally(`Z 8 + Lens ${i + 1}`, 90 - i * 3)),
        hiddenCameras: [tally("Apple iPhone 15 Pro", 1, true)],
        hiddenLenses: [tally("Unknown", 2, true)],
        years: YEARS,
      }),
    );

    for (const slide of deck.slides) {
      const note = slide.note ?? "";
      assert.doesNotMatch(
        note,
        /[\d,]+\s+(frames|files|photographs|photos|shots)/i,
        `${slide.id} footnotes a count: "${note}"`,
      );
      assert.doesNotMatch(note, /hidden/i, `${slide.id} mentions hiding: "${note}"`);
    }
  });
});

describe("the week", () => {
  const weekdays = [10, 20, 30, 40, 50, 60, 70];

  test("starts where the reader says it does", () => {
    const monday = findSlide(buildDeck(statsWith({ weekdays })).slides, "week");
    assert.ok(monday && monday.kind === "week");
    assert.equal(monday.labels[0], "Monday");
    assert.deepEqual(monday.days, weekdays);

    const sunday = findSlide(
      buildDeck(statsWith({ weekdays, weekStart: "sun" })).slides,
      "week",
    );
    assert.ok(sunday && sunday.kind === "week");
    assert.equal(sunday.labels[0], "Sunday");
    // Sunday's own count leads, and Saturday's brings up the rear.
    assert.equal(sunday.days[0], 70);
    assert.equal(sunday.days[6], 60);
    // The table has to agree with the chart, or the numbers view contradicts it.
    assert.equal(sunday.table.rows[0]?.[0], "Sun");
  });

  test("marks the weekend only when asked, wherever it has landed", () => {
    const plain = findSlide(buildDeck(statsWith({ weekdays })).slides, "week");
    assert.ok(plain && plain.kind === "week");
    assert.deepEqual(plain.weekend, []);

    const marked = findSlide(
      buildDeck(statsWith({ weekdays, weekStart: "sun", markWeekend: true })).slides,
      "week",
    );
    assert.ok(marked && marked.kind === "week");
    // Sunday first, so the weekend is the first column and the last.
    assert.deepEqual(marked.weekend, [0, 6]);
  });

  test("every choice rides with the slide", () => {
    const slide = findSlide(buildDeck(statsWith({ weekdays })).slides, "week");
    assert.deepEqual(
      slide?.settings?.map((setting) => setting.id),
      ["weekStart", "weekend", "layout.week"],
    );
  });
});

describe("streaks", () => {
  const daily = Array.from({ length: 40 }, (_, i) => ({ day: 20250101 + i, shots: 5 }));

  test("is banded by year, on whichever kind of year is chosen", () => {
    const slide = findSlide(
      buildDeck(
        statsWith({
          daily,
          longestStreak: { days: 40, from: 20250101, to: 20250209 },
          longestGap: { days: 12, from: 20250210, to: 20250222 },
          years: YEARS,
        }),
      ).slides,
      "streaks",
    );
    assert.ok(slide && slide.kind === "strip");
    assert.equal(slide.title, "Streaks");
    // The stats stub covers 2025, so the year that ended in August 2024 is not
    // part of this range and is not one of them.
    assert.deepEqual(
      slide.years.map((year) => year.label),
      ["2024–25", "2025–26"],
    );
    // How the days are laid out, and what a year means while they are.
    assert.deepEqual(
      slide.settings?.map((setting) => setting.id),
      ["wall", "yearBasis"],
    );
    assert.equal(slide.layout, "packed", "one wall by default");
  });

  /**
   * The case that made this necessary: a range with no end of its own runs to
   * today, so for the week after a start-date anniversary "all time" reaches a
   * day or two into a year that has barely begun. Every row of the wall is the
   * same height, so that stub took a quarter of it to draw two squares.
   */
  const wall = (from: number, to: number) => {
    const slide = findSlide(
      buildDeck(
        statsWith({
          range: resolveRange({ kind: "custom", from, to }, { firstDay: from, lastDay: to }),
          daily,
          longestStreak: { days: 40, from: 20250101, to: 20250209 },
          longestGap: { days: 12, from: 20250210, to: 20250222 },
          years: YEARS,
        }),
      ).slides,
      "streaks",
    );
    assert.ok(slide && slide.kind === "strip");
    return slide.years;
  };

  test("a year the range clips to a sliver does not take a row of its own", () => {
    const tail = wall(20230824, 20250826);
    assert.deepEqual(tail.map((year) => year.label), ["2023–24", "2024–25"]);
    // Folded, not dropped: the row before it runs on to cover those three days,
    // because the wall promises every day in the range.
    assert.equal(tail[1]?.to, 20250826);

    const head = wall(20240822, 20251231);
    assert.deepEqual(head.map((year) => year.label), ["2024–25", "2025–26"]);
    assert.equal(head[0]?.from, 20240822);
  });

  test("a whole year with nothing in it still earns its row", () => {
    // Only a *clipped* end is folded. A year the range covers in full has
    // something to say even when the camera stayed in the cupboard for it.
    assert.deepEqual(
      wall(20230824, 20260816).map((year) => year.label),
      ["2023–24", "2024–25", "2025–26"],
    );
  });

  test("one year has no row per year to offer, but still has months", () => {
    const slide = findSlide(
      buildDeck(
        statsWith({
          daily,
          longestStreak: { days: 40, from: 20250101, to: 20250209 },
          longestGap: { days: 12, from: 20250210, to: 20250222 },
          years: YEARS.slice(1, 2),
        }),
      ).slides,
      "streaks",
    );
    assert.ok(slide && slide.kind === "strip");
    assert.equal(slide.years.length, 1);

    // A row per year needs a second year to line up against. A block per month
    // needs a second month, which this range has twelve of — so the setting is
    // offered, without the option that would do nothing.
    assert.deepEqual(
      slide.settings?.map((setting) => setting.id),
      ["wall"],
    );
    assert.deepEqual(
      slide.settings?.[0]?.options.map((option) => option.value),
      ["packed", "months"],
    );
  });

  test("a range inside one month is one wall and nothing else", () => {
    const march = resolveRange({ kind: "custom", from: 20250301, to: 20250331 }, {
      firstDay: 20250301,
      lastDay: 20250331,
    });
    const slide = findSlide(
      buildDeck(
        statsWith({
          range: march,
          daily,
          longestStreak: { days: 8, from: 20250301, to: 20250308 },
          longestGap: { days: 5, from: 20250310, to: 20250314 },
          years: YEARS.slice(1, 2),
        }),
      ).slides,
      "streaks",
    );
    assert.ok(slide && slide.kind === "strip");
    assert.equal(slide.settings, undefined, "nothing to lay out differently");
  });

  test("a shape the range cannot hold falls back rather than emptying", () => {
    // A wall saved as "a row per year" while looking at five years, then opened
    // on a range with one. The setting outlives the range it was chosen in.
    const slide = findSlide(
      buildDeck(
        statsWith({
          daily,
          longestStreak: { days: 40, from: 20250101, to: 20250209 },
          longestGap: { days: 12, from: 20250210, to: 20250222 },
          years: YEARS.slice(1, 2),
          wall: "years",
        }),
      ).slides,
      "streaks",
    );
    assert.equal(slide?.kind === "strip" ? slide.layout : null, "packed");
  });

  test("says which number is the days out and which is the period", () => {
    const slide = findSlide(
      buildDeck(
        statsWith({
          daily,
          longestStreak: { days: 40, from: 20250101, to: 20250209 },
          longestGap: { days: 12, from: 20250210, to: 20250222 },
        }),
      ).slides,
      "streaks",
    );
    // The old note read "20 of 365 days", which said neither.
    assert.equal(slide?.note, "You were out on 20 days, 5% of the period");
  });
});

/**
 * A milestone stops being only a range boundary once it points at real gear:
 * the same fact annotates the charts and answers questions no photograph can.
 */
const milestone = (
  id: string,
  label: string,
  day: number,
  kind: "bought" | "sold" | "custom",
  gear?: { dimension: "camera" | "lens" | "teleconverter"; key: string; label: string; shots?: number },
): Milestone => ({
  id,
  label,
  day,
  until: day,
  kind,
  shots: null,
  gear: gear
    ? { ...gear, shots: gear.shots ?? 0, firstDay: day, lastDay: 20251231 }
    : null,
});

/** Oldest first, which is the order `computeStats` promises. */
const KIT: Milestone[] = [
  milestone("b1", "Bought the a9 III", 20250110, "bought", {
    dimension: "camera", key: "ilce9m3", label: "a9 III", shots: 4000,
  }),
  milestone("b2", "Bought the FE 200-600mm G", 20250120, "bought", {
    dimension: "lens", key: "fe200600", label: "FE 200-600mm G", shots: 3000,
  }),
  milestone("s1", "Sold the a7 II", 20250301, "sold", {
    dimension: "camera", key: "ilce7m2", label: "a7 II", shots: 900,
  }),
  milestone("c1", "Moved to Lisbon", 20250401, "custom"),
  milestone("b3", "Bought the 1.4x teleconverter", 20250601, "bought", {
    dimension: "teleconverter", key: "1.4x", label: "1.4x teleconverter", shots: 500,
  }),
];

describe("milestones on the charts", () => {
  const daily = Array.from({ length: 20 }, (_, i) => ({ day: 20250101 + i, shots: 5 }));
  const marked = () =>
    buildDeck(
      statsWith({
        milestones: KIT,
        // What is drawn where is the next block's business; this one is about
        // what a mark says, so every slide that can carry one does.
        showMarks: resolveMarks({ streaks: true }),
        daily,
        monthly: [
          { ym: 202501, shots: 60 },
          { ym: 202503, shots: 20 },
          { ym: 202506, shots: 40 },
        ],
        longestStreak: { days: 40, from: 20250101, to: 20250209 },
        longestGap: { days: 12, from: 20250210, to: 20250222 },
        timeline: {
          months: [202501, 202503, 202506],
          series: [
            { label: "FE 200-600mm G", values: [40, 10, 20] },
            { label: "FE 70-200mm GM II", values: [20, 10, 20] },
          ],
        },
      }),
    ).slides;

  test("reach the slides whose axis is time", () => {
    for (const id of ["timeline", "streaks"]) {
      const slide = findSlide(marked(), id);
      assert.equal(slide?.marks?.length, KIT.length, `${id} is missing its marks`);
    }
  });

  test("say the gear rather than the sentence", () => {
    const marks = findSlide(marked(), "streaks")?.marks ?? [];
    assert.deepEqual(
      marks.map((mark) => mark.label),
      ["+ a9 III", "+ FE 200-600mm G", "− a7 II", "Moved to Lisbon", "+ 1.4x teleconverter"],
    );
    // The hover keeps the whole thing, because the chart label is a compression.
    assert.equal(marks[0]?.full, "Bought the a9 III · 10 Jan 2025");
  });

  test("a slide with no milestones carries none", () => {
    const bare = statsWith({ daily, showMarks: resolveMarks({ streaks: true }) });
    assert.equal(findSlide(buildDeck(bare).slides, "streaks")?.marks, undefined);
  });
});

describe("kit history", () => {
  const kit = (milestones: Milestone[]) => findSlide(buildDeck(statsWith({ milestones })).slides, "kit");

  test("needs more than one piece of gear to be a history", () => {
    assert.equal(kit([]), undefined);
    assert.equal(kit(KIT.slice(0, 1)), undefined);
    // A milestone about nothing in particular cannot be in it.
    assert.equal(kit([KIT[0] as Milestone, KIT[3] as Milestone]), undefined);
    assert.ok(kit(KIT));
  });

  test("answers what a photograph cannot", () => {
    const slide = kit(KIT);
    assert.ok(slide && slide.kind === "list");

    const facts = slide.items.map((item) => `${item.meta} → ${item.label} → ${item.value}`);
    assert.match(String(facts[0]), /^First body you bought · 10 Jan 2025 → a9 III → 4,000 frames/);
    assert.ok(facts.some((fact) => /First lens you bought .* FE 200-600mm G/.test(fact)));
    assert.ok(facts.some((fact) => /First thing you sold .* a7 II/.test(fact)));
    assert.ok(facts.some((fact) => /Longest you went without buying anything/.test(fact)));
  });

  test("counts the sold body as gone and the rest as still yours", () => {
    const slide = kit(KIT);
    const held = slide?.kind === "list" ? slide.items.find((i) => i.meta.startsWith("Owned longest")) : null;
    // The a9 III is the earliest purchase that was never sold. The a7 II was
    // bought before the range and sold inside it, so it is not still yours.
    assert.equal(held?.label, "a9 III");
  });

  test("every date on it comes from a milestone, and it says so", () => {
    const slide = kit(KIT);
    assert.equal(slide?.subtitle, "Dated by you, not guessed from a first frame");
    for (const item of slide?.kind === "list" ? slide.items : []) {
      assert.match(item.meta, /\d{4}/, `"${item.meta}" shows no date`);
    }
  });
});

describe("new in the bag", () => {
  const debuts = [
    { kind: "camera" as const, key: "ilce9m3", label: "a9 III", day: 20250115, shots: 4000 },
    { kind: "lens" as const, key: "fe70200", label: "FE 70-200mm GM II", day: 20250220, shots: 800 },
  ];

  test("a milestone beats a first frame, and the row says which it used", () => {
    const slide = findSlide(buildDeck(statsWith({ debuts, milestones: KIT })).slides, "debuts");
    assert.ok(slide && slide.kind === "list");

    // The a9 III has a purchase date; the lens has only the day it first fired.
    assert.match(String(slide.items[0]?.meta), /bought 10 Jan 2025/);
    assert.match(String(slide.items[1]?.meta), /first frame 20 Feb 2025/);
    assert.equal(
      slide.note,
      "Dated by your milestones where you have one, and by a first frame otherwise",
    );
  });

  test("with nothing saved it is honest about guessing", () => {
    const slide = findSlide(buildDeck(statsWith({ debuts })).slides, "debuts");
    assert.equal(slide?.note, "Dated by its first frame anywhere in your library");
  });
});

describe("spans of time", () => {
  test("are said the way people say them", () => {
    assert.equal(fmtSpan(0), "0 days");
    assert.equal(fmtSpan(1), "1 day");
    assert.equal(fmtSpan(44), "44 days");
    assert.equal(fmtSpan(60), "2 months");
    assert.equal(fmtSpan(365), "12 months");
    assert.equal(fmtSpan(730), "2 years");
    assert.equal(fmtSpan(1000), "2 years 9 months");
  });
});

/**
 * One switch per slide, and they disagree on purpose: month by month has a
 * strip down its side doing nothing else, and the wall of days has a square to
 * lose for every mark drawn on it.
 */
describe("which slides draw the milestones", () => {
  const daily = Array.from({ length: 20 }, (_, i) => ({ day: 20250101 + i, shots: 5 }));
  const base = {
    // Long enough that the day grid gives way to month by month, which is the
    // one of the two that draws marks.
    range: resolveRange({ kind: "all" }, { firstDay: 20240101, lastDay: 20260630 }, NOW),
    milestones: KIT,
    busiestDay: { day: 20250115, shots: 30 },
    daily,
    monthly: [
      { ym: 202501, shots: 60 },
      { ym: 202503, shots: 20 },
      { ym: 202506, shots: 40 },
    ],
    longestStreak: { days: 40, from: 20250101, to: 20250209 },
    longestGap: { days: 12, from: 20250210, to: 20250222 },
    timeline: {
      months: [202501, 202503, 202506],
      series: [
        { label: "FE 200-600mm G", values: [40, 10, 20] },
        { label: "FE 70-200mm GM II", values: [20, 10, 20] },
      ],
    },
  };

  const slides = (marks = {}) => buildDeck(statsWith({ ...base, showMarks: resolveMarks(marks) })).slides;
  const marksOn = (id: string, marks = {}) => (findSlide(slides(marks), id)?.marks?.length ?? 0) > 0;
  const setting = (id: string, marks = {}) =>
    findSlide(slides(marks), id)?.settings?.find((s) => s.id.startsWith("marks."));

  test("month by month is marked out of the box and the wall of days is not", () => {
    assert.equal(marksOn("calendar"), true);
    assert.equal(marksOn("timeline"), true);
    assert.equal(marksOn("streaks"), false);
  });

  test("each carries its own switch, named for itself", () => {
    assert.equal(setting("calendar")?.id, "marks.months");
    assert.equal(setting("streaks")?.id, "marks.streaks");
    assert.equal(setting("timeline")?.id, "marks.timeline");

    // And each says where it currently stands rather than where the deck does.
    assert.equal(setting("calendar")?.value, "on");
    assert.equal(setting("streaks")?.value, "off");
    assert.equal(setting("streaks")?.options[0]?.note, "5 in this range");
  });

  test("turning one off leaves the others alone", () => {
    assert.equal(marksOn("calendar", { months: false }), false);
    assert.equal(marksOn("timeline", { months: false }), true);
    assert.equal(marksOn("streaks", { streaks: true }), true);
    assert.equal(marksOn("calendar", { streaks: true }), true);
  });

  test("the way back stays on the slide it was turned off from", () => {
    assert.equal(setting("calendar", { months: false })?.value, "off");
    assert.equal(setting("streaks", { streaks: true })?.value, "on");
  });

  test("no switch at all when there is nothing to hide", () => {
    const bare = buildDeck(statsWith({ ...base, milestones: [] })).slides;
    for (const id of ["calendar", "streaks", "timeline"]) {
      assert.equal(findSlide(bare, id)?.settings?.some((s) => s.id.startsWith("marks.")) ?? false, false);
    }
  });

  test("the settings a slide already had are kept, in order", () => {
    const slide = findSlide(buildDeck(statsWith({ ...base, years: YEARS })).slides, "streaks");
    assert.deepEqual(
      slide?.settings?.map((setting) => setting.id),
      ["wall", "yearBasis", "marks.streaks"],
    );
  });
});

describe("the first body upgrade", () => {
  const bodies = (...days: number[]): Milestone[] =>
    days.map((day, i) =>
      milestone(`b${i}`, `Bought body ${i}`, day, "bought", {
        dimension: "camera",
        key: `body${i}`,
        label: `Body ${i}`,
        shots: 100,
      }),
    );

  const row = (milestones: Milestone[]) => {
    const slide = findSlide(buildDeck(statsWith({ milestones })).slides, "kit");
    return slide?.kind === "list" ? slide.items.find((i) => i.meta.startsWith("First body upgrade")) : null;
  };

  test("is the day the second one arrived", () => {
    const found = row(bodies(20240101, 20250301, 20260101));
    assert.equal(found?.label, "Body 0 → Body 1");
    assert.equal(found?.meta, "First body upgrade · 1 Jan 2024 to 1 Mar 2025");
    assert.equal(found?.value, "14 months");
  });

  test("one body is not an upgrade", () => {
    // Still a history — there is a lens in it — but nothing to upgrade from.
    assert.equal(row([...bodies(20240101), ...KIT.slice(1, 2)]), undefined);
  });

  test("selling the first one is a separate fact, and does not make the upgrade", () => {
    const sold = milestone("s", "Sold body 0", 20250601, "sold", {
      dimension: "camera",
      key: "body0",
      label: "Body 0",
    });
    const found = row([...bodies(20240101, 20250301), sold]);
    assert.equal(found?.label, "Body 0 → Body 1");
  });
});

describe("the shortest thing you kept", () => {
  const buy = (id: string, day: number, key: string, label: string) =>
    milestone(id, `Bought the ${label}`, day, "bought", { dimension: "lens", key, label });
  const sell = (id: string, day: number, key: string, label: string) =>
    milestone(id, `Sold the ${label}`, day, "sold", { dimension: "lens", key, label });

  const row = (milestones: Milestone[]) => {
    const slide = findSlide(buildDeck(statsWith({ milestones })).slides, "kit");
    return slide?.kind === "list"
      ? slide.items.find((i) => i.meta.startsWith("Shortest you kept"))
      : null;
  };

  test("pairs each sale with the purchase it ended", () => {
    const found = row([
      buy("b1", 20240101, "a", "Lens A"),
      buy("b2", 20240201, "b", "Lens B"),
      sell("s1", 20240301, "b", "Lens B"),
      sell("s2", 20250101, "a", "Lens A"),
    ]);
    assert.equal(found?.label, "Lens B");
    assert.equal(found?.value, "29 days");
  });

  test("a thing bought again is not owned since the first time", () => {
    // Bought, sold, bought, sold: the second ownership is the short one, and
    // pairing the last sale with the first purchase would hide it.
    const found = row([
      buy("b1", 20240101, "a", "Lens A"),
      sell("s1", 20240401, "a", "Lens A"),
      buy("b2", 20250101, "a", "Lens A"),
      sell("s2", 20250115, "a", "Lens A"),
    ]);
    assert.equal(found?.value, "14 days");
  });

  test("one sale says it once", () => {
    // "First thing you sold" already carries how long it lasted; a second row
    // for the same fact is the same number twice on one slide.
    assert.equal(row([buy("b1", 20240101, "a", "Lens A"), sell("s1", 20240301, "a", "Lens A")]), undefined);
  });
});

describe("how much the kit history repeats itself", () => {
  const buy = (id: string, day: number, key: string, label: string) =>
    milestone(id, `Bought the ${label}`, day, "bought", { dimension: "lens", key, label, shots: 500 });
  const sell = (id: string, day: number, key: string, label: string) =>
    milestone(id, `Sold the ${label}`, day, "sold", { dimension: "lens", key, label, shots: 500 });

  // The first lens bought is the first one sold, and it is also the shortest
  // ownership of the two — which is the shape the real thing takes, and the
  // one where three rows used to carry one lens.
  const MILESTONES = [
    buy("b1", 20240101, "a", "Lens A"),
    buy("b2", 20240301, "b", "Lens B"),
    sell("s1", 20240601, "a", "Lens A"),
    sell("s2", 20251201, "b", "Lens B"),
  ];

  const slideWith = (kit: KitToggles) => {
    const found = findSlide(buildDeck(statsWith({ milestones: MILESTONES, kit: resolveKit(kit) })).slides, "kit");
    assert.ok(found && found.kind === "list");
    return found;
  };

  const metas = (kit: KitToggles) => slideWith(kit).items.map((item) => item.meta);
  const setting = (kit: KitToggles, id: string) => slideWith(kit).settings?.find((one) => one.id === id);

  test("says one lens once, by default", () => {
    const found = metas({});
    assert.ok(found.some((meta) => meta.startsWith("First lens you bought, and the first you sold")));
    assert.ok(!found.some((meta) => meta.startsWith("First thing you sold")));
    // And the shortest ownership is that same purchase and that same sale, so
    // the row would be the line above with a new heading on it.
    assert.ok(!found.some((meta) => meta.startsWith("Shortest you kept")));
    assert.equal(found.filter((meta) => meta.includes("Lens A")).length, 0, "the label carries the name, not the meta");
  });

  test("tells them apart when asked to", () => {
    const found = metas({ combine: false });
    assert.ok(found.some((meta) => meta.startsWith("First lens you bought ·")));
    assert.ok(found.some((meta) => meta.startsWith("First thing you sold ·")));
    // Nothing is folded away, so the shortest ownership is its own row again.
    assert.ok(found.some((meta) => meta.startsWith("Shortest you kept")));
  });

  test("drops the ownership row on its own", () => {
    const found = metas({ combine: false, ownership: false });
    assert.ok(found.some((meta) => meta.startsWith("First thing you sold ·")));
    assert.ok(!found.some((meta) => meta.startsWith("Shortest you kept")));
  });

  test("offers the switch it is currently off", () => {
    // The trap this is guarding: deciding whether to offer the switch by asking
    // the switch, which hides it the moment it is turned off.
    assert.equal(setting({}, "kit.combine")?.value, "on");
    assert.equal(setting({ combine: false }, "kit.combine")?.value, "off");
    assert.equal(setting({ combine: false, ownership: false }, "kit.ownership")?.value, "off");
  });

  test("offers neither switch when there is nothing to fold", () => {
    const plain = findSlide(
      buildDeck(statsWith({ milestones: [buy("b1", 20240101, "a", "Lens A"), buy("b2", 20240301, "b", "Lens B")] }))
        .slides,
      "kit",
    );
    assert.equal(plain?.settings, undefined);
  });
});

describe("bought first and sold first", () => {
  const buy = (id: string, day: number, key: string, label: string, dimension: "camera" | "lens" = "lens") =>
    milestone(id, `Bought the ${label}`, day, "bought", { dimension, key, label, shots: 1200 });
  const sell = (id: string, day: number, key: string, label: string, dimension: "camera" | "lens" = "lens") =>
    milestone(id, `Sold the ${label}`, day, "sold", { dimension, key, label, shots: 1200 });

  const facts = (milestones: Milestone[]) => {
    const slide = findSlide(buildDeck(statsWith({ milestones })).slides, "kit");
    return slide?.kind === "list" ? slide.items : [];
  };

  test("are one row when they are the same object", () => {
    const items = facts([buy("b1", 20240101, "a", "Lens A"), sell("s1", 20240401, "a", "Lens A")]);
    const row = items.find((item) => item.meta.startsWith("First lens you bought"));

    assert.equal(row?.meta, "First lens you bought, and the first you sold · 1 Jan 2024 to 1 Apr 2024 · 3 months");
    assert.equal(row?.label, "Lens A");
    assert.equal(row?.value, "1,200 frames");
    // The name, the frame count and the story appear once between them.
    assert.equal(items.filter((item) => item.label === "Lens A").length, 1);
    assert.ok(!items.some((item) => item.meta.startsWith("First thing you sold")));
  });

  test("a body does the same", () => {
    const items = facts([
      buy("b1", 20240101, "a", "Body A", "camera"),
      buy("b2", 20240601, "b", "Lens B"),
      sell("s1", 20241231, "a", "Body A", "camera"),
    ]);
    assert.ok(
      items.some((item) => item.meta.startsWith("First body you bought, and the first you sold")),
      items.map((item) => item.meta).join(" / "),
    );
    assert.ok(!items.some((item) => item.meta.startsWith("First thing you sold")));
  });

  test("stay two rows when they are different things", () => {
    const items = facts([
      buy("b1", 20240101, "a", "Lens A"),
      buy("b2", 20240201, "b", "Lens B"),
      sell("s1", 20240301, "b", "Lens B"),
    ]);
    assert.ok(items.some((item) => item.meta.startsWith("First lens you bought ·")));
    assert.ok(items.some((item) => item.meta.startsWith("First thing you sold ·")));
  });

  test("stay two rows when the sale came first", () => {
    // Sold, then bought again: the same name, but not the same ownership, and
    // a single row would run backwards from 2025 to 2024.
    const items = facts([
      sell("s1", 20240301, "a", "Lens A"),
      buy("b1", 20250101, "a", "Lens A"),
      buy("b2", 20250201, "b", "Lens B"),
    ]);
    assert.ok(items.some((item) => item.meta.startsWith("First lens you bought ·")));
    assert.ok(items.some((item) => item.meta.startsWith("First thing you sold ·")));
  });
});

describe("which kinds of milestone get drawn", () => {
  const dated = (id: string, label: string, day: number, kind: "bought" | "custom" | "trip" | "shoot") => ({
    id,
    label,
    day,
    until: day,
    kind,
    shots: kind === "trip" || kind === "shoot" ? 120 : null,
    gear:
      kind === "bought"
        ? { dimension: "camera" as const, key: "a9", label: "a9 III", shots: 10, firstDay: day, lastDay: day }
        : null,
  });

  const MIXED: Milestone[] = [
    dated("b", "Bought the a9 III", 20250110, "bought"),
    { ...dated("t", "Iceland", 20250301, "trip"), until: 20250315 },
    dated("s", "The wedding", 20250614, "shoot"),
    dated("c", "Moved to Lisbon", 20250901, "custom"),
  ];

  const marksOn = (types: Parameters<typeof resolveTypes>[0]) => {
    const slide = findSlide(
      buildDeck(
        statsWith({
          milestones: MIXED,
          showTypes: resolveTypes(types),
          showMarks: resolveMarks({ streaks: true }),
          daily: [{ day: 20250110, shots: 5 }],
          longestStreak: { days: 40, from: 20250101, to: 20250209 },
          longestGap: { days: 12, from: 20250210, to: 20250222 },
        }),
      ).slides,
      "streaks",
    );
    return slide?.kind === "strip" ? slide : null;
  };

  test("all four kinds by default", () => {
    assert.equal(marksOn({})?.marks?.length, 4);
  });

  test("a kind turned off leaves the others alone", () => {
    const marks = marksOn({ trip: false, custom: false })?.marks ?? [];
    assert.deepEqual(
      marks.map((mark) => mark.label),
      ["+ a9 III", "The wedding"],
    );
  });

  test("a trip carries its span, and nothing else does", () => {
    const marks = marksOn({})?.marks ?? [];
    const trip = marks.find((mark) => mark.label === "Iceland");
    assert.equal(trip?.until, 20250315);
    assert.equal(marks.find((mark) => mark.label === "The wedding")?.until, undefined);
  });

  test("the hover on a trip says the span and what came out of it", () => {
    const trip = (marksOn({})?.marks ?? []).find((mark) => mark.label === "Iceland");
    assert.equal(trip?.full, "Iceland · 1 Mar 2025 to 15 Mar 2025 · 120 photographs");
    // A purchase counts nothing: the frames taken the day a camera arrived say
    // nothing about the camera, and `gear.shots` is the honest number.
    const bought = (marksOn({})?.marks ?? []).find((mark) => mark.label === "+ a9 III");
    assert.equal(bought?.full, "Bought the a9 III · 10 Jan 2025");
  });

  test("a switch per kind, and only for the kinds that are there", () => {
    const settings = marksOn({})?.settings?.map((one) => one.id) ?? [];
    assert.deepEqual(settings.filter((id) => id.startsWith("type.")), [
      "type.gear",
      "type.trip",
      "type.shoot",
      "type.custom",
    ]);
  });

  test("one kind of milestone is nothing to choose between", () => {
    const slide = findSlide(
      buildDeck(
        statsWith({
          milestones: [MIXED[0] as Milestone],
          showMarks: resolveMarks({ streaks: true }),
          daily: [{ day: 20250110, shots: 5 }],
          longestStreak: { days: 40, from: 20250101, to: 20250209 },
          longestGap: { days: 12, from: 20250210, to: 20250222 },
        }),
      ).slides,
      "streaks",
    );
    const ids = slide?.settings?.map((one) => one.id) ?? [];
    assert.deepEqual(ids.filter((id) => id.startsWith("type.")), []);
  });

  test("the marks switch counts what it would actually show", () => {
    // "42 in this range" beside a chart drawing six is a chip that has stopped
    // describing the thing it controls.
    const setting = marksOn({ trip: false, custom: false })?.settings?.find((one) => one.id === "marks.streaks");
    assert.equal(setting?.options[0]?.note, "2 in this range");
  });
});

/**
 * The frames that are not there any more.
 *
 * Nothing in a catalog records what used to be in it, so everything thrown out
 * before this tool first ran is a number only the reader can supply. What it is
 * allowed to touch is the whole question: the two slides that answer "how many
 * photographs" add it, the culling slide counts it as a reject because a
 * permanently deleted frame is a decision and it is not "keep", and no
 * denominator anywhere else moves — those frames have no day, no camera and no
 * exposure behind them.
 */
describe("photographs deleted before indexing", () => {
  const withDeleted = (deletedBefore: number, culling: Partial<DeckStats["culling"]> = {}) => {
    const base = statsWith({});
    return statsWith({
      totals: { ...base.totals, deletedBefore },
      culling: { ...base.culling, deletedBefore, ...culling },
    });
  };

  test("the opening total counts them, and nothing else does", () => {
    const slide = findSlide(buildDeck(withDeleted(40)).slides, "opening");
    assert.ok(slide && slide.kind === "hero");

    assert.equal(slide.value, "140");
    assert.equal(slide.headline, "140 photographs");

    // The rate is per *day*, and these frames have no day. 100 in the library
    // over 20 days out is still five a day — folding the deleted ones in would
    // date them all to days the reader happened to be shooting.
    assert.equal(slide.tiles.find((tile) => tile.label === "Busiest average")?.value, "5/day");
  });

  test("the table says how that total is made up", () => {
    const slide = findSlide(buildDeck(withDeleted(40)).slides, "opening");
    const rows = new Map((slide?.table?.rows ?? []).map((row) => [row[0], row[1]]));

    assert.equal(rows.get("Photographs"), 140);
    assert.equal(rows.get("Still in the library"), 100);
    assert.equal(rows.get("Deleted before indexing"), 40);
  });

  test("a library with none of them is left exactly as it was", () => {
    const slide = findSlide(buildDeck(statsWith({})).slides, "opening");
    assert.ok(slide && slide.kind === "hero");
    assert.equal(slide.value, "100");

    const labels = (slide.table?.rows ?? []).map((row) => row[0]);
    assert.ok(!labels.includes("Still in the library"), labels.join(", "));
    assert.ok(!labels.includes("Deleted before indexing"), labels.join(", "));
  });

  test("the closing slide agrees with the opening one", () => {
    const slide = findSlide(buildDeck(withDeleted(40)).slides, "closing");
    assert.ok(slide && slide.kind === "tiles");
    assert.equal(slide.tiles.find((tile) => tile.label === "Photographs")?.value, "140");
  });

  test("culling counts them as rejects, and says so", () => {
    const slide = findSlide(
      buildDeck(withDeleted(100, { picked: 60, rejected: 20, unflagged: 20 })).slides,
      "culling",
    );
    assert.ok(slide && slide.kind === "verdict");

    const rejected = slide.cards[1];
    assert.equal(rejected?.label, "Rejected");
    assert.equal(rejected?.value, "120");
    // 120 of 200 decided-or-not, not 20 of 100.
    assert.equal(rejected?.note, "60% of your frames");
    assert.equal(slide.headline, "You throw out 2.0 frames for every one you keep");
    assert.equal(slide.note, "Rejects include the ones you had already deleted");
  });

  test("the culling table keeps the two kinds of deletion apart", () => {
    const slide = findSlide(
      buildDeck(withDeleted(100, { picked: 60, rejected: 20, unflagged: 20, removed: 7 })).slides,
      "culling",
    );
    const rows = new Map((slide?.table?.rows ?? []).map((row) => [row[0], [row[1], row[2]]]));

    assert.deepEqual(rows.get("Rejected"), [120, "60%"]);
    assert.deepEqual(rows.get("Deleted before indexing"), [100, "counted as rejects above"]);
    assert.deepEqual(rows.get("Deleted since indexing"), [7, "not in any count above"]);
  });

  /**
   * A folder library carries no flags at all, so somebody who fills this figure
   * in can reach the culling slide having never flagged a single frame — and
   * the headline must not then name a flag they have never set.
   */
  test("a library with no flags at all still has something to say", () => {
    const slide = findSlide(buildDeck(withDeleted(100, { unflagged: 500 })).slides, "culling");
    assert.ok(slide && slide.kind === "verdict");
    assert.equal(slide.headline, "Everything you have decided about, you deleted");
    assert.equal(slide.cards[1]?.value, "100");
  });

  test("without them, a library with no flags has no culling slide", () => {
    assert.equal(findSlide(buildDeck(statsWith({})).slides, "culling"), undefined);
  });
});
