import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildDeck, fmtSpan, type Slide } from "../src/stats/slides.ts";
import { resolveLimits, type DeckStats, type Milestone, type Tally } from "../src/stats/aggregate.ts";
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
    places: [], placesKnown: 0, debuts: [], milestones: [], burst: null,
    years: [], yearBasis: "anchor", location: null, home: null,
    weekStart: "mon", markWeekend: false, showMarks: true, wall: "packed",
    culling: { picked: 0, rejected: 0, unflagged: 0, removed: 0, removedRejected: 0, watchingSince: null },
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

  test("both choices ride with the slide", () => {
    const slide = findSlide(buildDeck(statsWith({ weekdays })).slides, "week");
    assert.deepEqual(
      slide?.settings?.map((setting) => setting.id),
      ["weekStart", "weekend"],
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

  test("one year is one wall, and nothing to choose between", () => {
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
    assert.equal(slide.settings, undefined);
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
  kind,
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
    assert.equal(findSlide(buildDeck(statsWith({ daily })).slides, "streaks")?.marks, undefined);
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

describe("turning the milestones off", () => {
  const daily = Array.from({ length: 20 }, (_, i) => ({ day: 20250101 + i, shots: 5 }));
  const base = {
    // Long enough that the day grid gives way to month by month, which is the one
    // of the two that draws marks.
    range: resolveRange({ kind: "all" }, { firstDay: 20240101, lastDay: 20260630 }),
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
  const annotated = ["timeline", "streaks", "calendar"];

  test("is offered on every slide that can draw them", () => {
    const slides = buildDeck(statsWith(base)).slides;
    for (const id of annotated) {
      const setting = findSlide(slides, id)?.settings?.find((s) => s.id === "marks");
      assert.ok(setting, `${id} cannot turn its milestones off`);
      assert.equal(setting.value, "on");
      assert.equal(setting.options[0]?.note, "5 in this range");
    }
  });

  test("takes them off every slide at once", () => {
    const slides = buildDeck(statsWith({ ...base, showMarks: false })).slides;
    for (const id of annotated) {
      const slide = findSlide(slides, id);
      assert.equal(slide?.marks, undefined, `${id} is still marked`);
      // The way back has to stay on the slide it was turned off from.
      assert.equal(slide?.settings?.find((s) => s.id === "marks")?.value, "off");
    }
  });

  test("is not offered when there is nothing to hide", () => {
    const slides = buildDeck(statsWith({ ...base, milestones: [] })).slides;
    for (const id of annotated) {
      assert.equal(findSlide(slides, id)?.settings?.some((s) => s.id === "marks") ?? false, false);
    }
  });

  test("leaves the settings a slide already had alone", () => {
    const slide = findSlide(buildDeck(statsWith({ ...base, years: YEARS })).slides, "streaks");
    assert.deepEqual(
      slide?.settings?.map((setting) => setting.id),
      ["wall", "yearBasis", "marks"],
    );
  });
});
