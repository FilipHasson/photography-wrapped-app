import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseRangeSpec, rangeQuery, resolveRange } from "../src/stats/range.ts";

/**
 * A monthly report, an annual wrapped and "everything I have ever shot" are the
 * three things this tool is asked for, and they are all one pair of days.
 */

const NOW = new Date(2025, 7, 18); // 18 August 2025, local — the same clock the photos use.
const EMPTY = { firstDay: null, lastDay: null };
const LIBRARY = { firstDay: 20180612, lastDay: 20250801 };

describe("ranges", () => {
  test("all time is whatever the index holds", () => {
    const range = resolveRange({ kind: "all" }, LIBRARY, NOW);
    assert.equal(range.from, 20180612);
    assert.equal(range.to, 20250801);
    assert.equal(range.label, "All time");
    assert.equal(range.previous, null, "nothing precedes everything");
  });

  test("all time over an empty index is today, not the epoch", () => {
    const range = resolveRange({ kind: "all" }, EMPTY, NOW);
    assert.equal(range.from, 20250818);
    assert.equal(range.to, 20250818);
  });

  test("a year is the whole year, whether or not it is over", () => {
    const range = resolveRange({ kind: "year", year: 2025 }, LIBRARY, NOW);
    assert.equal(range.from, 20250101);
    assert.equal(range.to, 20251231);
    assert.equal(range.days, 365);
    assert.deepEqual(
      { from: range.previous?.from, to: range.previous?.to, label: range.previous?.label },
      { from: 20240101, to: 20241231, label: "2024" },
    );
  });

  test("a month knows how long it is", () => {
    const february = resolveRange({ kind: "month", year: 2024, month: 2 }, LIBRARY, NOW);
    assert.equal(february.to, 20240229);
    assert.equal(february.days, 29);
    assert.equal(february.label, "February 2024");

    // January's previous month is last December.
    const january = resolveRange({ kind: "month", year: 2025, month: 1 }, LIBRARY, NOW);
    assert.equal(january.previous?.from, 20241201);
    assert.equal(january.previous?.to, 20241231);
  });

  test("the last thirty days ends today and compares with the thirty before", () => {
    const range = resolveRange({ kind: "last", days: 30 }, LIBRARY, NOW);
    assert.equal(range.to, 20250818);
    assert.equal(range.from, 20250720);
    assert.equal(range.days, 30);
    assert.equal(range.previous?.to, 20250719);
    assert.equal(range.previous?.from, 20250620);
  });

  test("a custom span is compared with the span before it", () => {
    const range = resolveRange({ kind: "custom", from: 20250301, to: 20250331 }, LIBRARY, NOW);
    assert.equal(range.days, 31);
    // A whole calendar month reads as that month, however it was asked for.
    assert.equal(range.label, "March 2025");
    assert.equal(range.previous?.from, 20250129);
    assert.equal(range.previous?.to, 20250228);
  });

  test("dates the wrong way round are still a range", () => {
    const range = resolveRange({ kind: "custom", from: 20250331, to: 20250301 }, LIBRARY, NOW);
    assert.equal(range.from, 20250301);
    assert.equal(range.to, 20250331);
  });
});

describe("ranges in a URL", () => {
  const parse = (query: string) => parseRangeSpec(new URLSearchParams(query));

  test("survives the round trip", () => {
    for (const spec of [
      { kind: "all" as const },
      { kind: "year" as const, year: 2025 },
      { kind: "month" as const, year: 2025, month: 3 },
      { kind: "last" as const, days: 30 },
      { kind: "custom" as const, from: 20250301, to: 20250331 },
    ]) {
      assert.deepEqual(parse(rangeQuery(spec)), spec);
    }
  });

  test("nonsense falls back to all time rather than failing", () => {
    assert.deepEqual(parse("range=year&year=banana"), { kind: "all" });
    assert.deepEqual(parse("range=month&year=2025&month=13"), { kind: "all" });
    assert.deepEqual(parse("range=custom&from=2025-13-40&to=x"), { kind: "all" });
    assert.deepEqual(parse(""), { kind: "all" });
  });
});
