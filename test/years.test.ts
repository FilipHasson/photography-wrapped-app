import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { yearPeriods } from "../src/stats/aggregate.ts";
import { resolveRange } from "../src/stats/range.ts";

/**
 * A year is not always a calendar year.
 *
 * Someone who bought their camera in August thinks in years that start in
 * August, and the difference is not cosmetic — it decides which side of a
 * boundary a trip falls on, and therefore which year was the busy one.
 */

const range = (from: number, to: number) =>
  resolveRange({ kind: "custom", from, to }, { firstDay: null, lastDay: null });

const shape = (periods: Array<{ from: number; to: number; label: string }>) =>
  periods.map((period) => `${period.label} ${period.from}-${period.to}`);

describe("years from an anchor date", () => {
  test("run from the anchor day to the day before it comes round again", () => {
    const periods = yearPeriods(range(20230824, 20260816), "anchor", 20230824, 20260816);
    assert.deepEqual(shape(periods), [
      "2023–24 20230824-20240823",
      "2024–25 20240824-20250823",
      "2025–26 20250824-20260816",
    ]);
  });

  test("a leap day does not shift the boundary", () => {
    const periods = yearPeriods(range(20230301, 20250301), "anchor", 20230301, 20250301);
    assert.deepEqual(shape(periods).slice(0, 2), [
      "2023–24 20230301-20240229",
      "2024–25 20240301-20250228",
    ]);
  });

  test("a range starting mid-year keeps its short first period", () => {
    // The library starts in August; this range starts in the January after, so
    // the first period is the five months that are actually in it.
    const periods = yearPeriods(range(20240101, 20250901), "anchor", 20230824, 20250901);
    assert.deepEqual(shape(periods), [
      "2023–24 20240101-20240823",
      "2024–25 20240824-20250823",
      "2025–26 20250824-20250901",
    ]);
  });

  test("the period still running is marked, and no others are", () => {
    const periods = yearPeriods(range(20230824, 20260816), "anchor", 20230824, 20260816);
    assert.deepEqual(
      periods.map((period) => period.partial),
      [false, false, true],
    );
  });

  test("with no anchor it falls back to calendar years", () => {
    const periods = yearPeriods(range(20240101, 20251231), "anchor", null, 20251231);
    assert.deepEqual(shape(periods), ["2024 20240101-20241231", "2025 20250101-20251231"]);
  });
});

describe("calendar years", () => {
  test("are January to December, clipped to the range", () => {
    const periods = yearPeriods(range(20230824, 20250620), "calendar", 20230824, 20250620);
    assert.deepEqual(shape(periods), [
      "2023 20230824-20231231",
      "2024 20240101-20241231",
      "2025 20250101-20250620",
    ]);
  });

  test("one year in, one year out", () => {
    assert.equal(yearPeriods(range(20250101, 20251231), "calendar", null, 20251231).length, 1);
  });
});
