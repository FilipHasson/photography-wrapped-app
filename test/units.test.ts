import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  apertureBucket,
  apexToAperture,
  apexToShutter,
  exposureValue,
  focalBucket,
  focalClass,
  formatAperture,
  formatFocal,
  formatShutter,
  isoBucket,
  shutterBucket,
} from "../src/core/units.ts";
import {
  addDays,
  daysBetween,
  epochSecondsOf,
  formatDay,
  parseExifDate,
  weekdayOf,
} from "../src/core/time.ts";

describe("snapping to the scales people use", () => {
  test("apertures land on real stops", () => {
    assert.equal(apertureBucket(2.8), 2.8);
    assert.equal(apertureBucket(2.79), 2.8);
    assert.equal(apertureBucket(7.1), 7.1);
    assert.equal(apertureBucket(8.0), 8);
    assert.equal(apertureBucket(null), null);
    assert.equal(apertureBucket(0), null);
  });

  test("focal lengths land on numbers printed on barrels", () => {
    assert.equal(focalBucket(24), 24);
    assert.equal(focalBucket(23), 24);
    assert.equal(focalBucket(52.5), 50);
    assert.equal(focalBucket(0), null);
  });

  test("ISO lands on full stops, and the top end pools", () => {
    assert.equal(isoBucket(200), 200);
    assert.equal(isoBucket(320), 400);
    assert.equal(isoBucket(64), 50);
    assert.equal(isoBucket(1_000_000), 102400);
  });

  test("shutter speeds land on full stops, and bulb pools", () => {
    assert.equal(shutterBucket(1 / 250), 1 / 250);
    assert.equal(shutterBucket(1 / 320), 1 / 250);
    assert.equal(shutterBucket(240), 30);
    assert.equal(shutterBucket(0), null);
  });

  test("angle of view is judged on the 35mm equivalent", () => {
    // 23mm on APS-C frames like a 35mm — normal, not wide.
    assert.equal(focalClass(35), "normal");
    assert.equal(focalClass(24), "wide");
    assert.equal(focalClass(16), "ultra-wide");
    assert.equal(focalClass(400), "super tele");
    assert.equal(focalClass(null), null);
  });
});

describe("reading the numbers back", () => {
  test("undoes the logarithms a catalog stores", () => {
    assert.ok(Math.abs((apexToAperture(2 * Math.log2(2.8)) ?? 0) - 2.8) < 0.01);
    assert.ok(Math.abs((apexToShutter(-Math.log2(1 / 250)) ?? 0) - 1 / 250) < 1e-6);
    assert.equal(apexToAperture(NaN), null);
  });

  test("writes them the way a photographer says them", () => {
    assert.equal(formatAperture(2.8), "f/2.8");
    assert.equal(formatAperture(11), "f/11");
    assert.equal(formatShutter(1 / 250), "1/250");
    assert.equal(formatShutter(2), "2s");
    assert.equal(formatFocal(24), "24mm");
    assert.equal(formatShutter(null), "—");
  });

  test("exposure value puts a number on how dark it was", () => {
    // Bright sun is EV 15: f/16 at 1/125, ISO 100.
    assert.ok(Math.abs((exposureValue(16, 1 / 125, 100) ?? 0) - 15) < 0.05);
    // Two stops darker for the same exposure means EV 13.
    assert.ok(Math.abs((exposureValue(8, 1 / 125, 100) ?? 0) - 13) < 0.05);
    assert.equal(exposureValue(null, 1 / 100, 100), null);
  });
});

describe("dates without timezones", () => {
  test("reads what cameras and catalogs actually write", () => {
    assert.equal(parseExifDate("2024:05:01 14:23:45"), 20240501142345);
    assert.equal(parseExifDate("2024-05-01T14:23:45"), 20240501142345);
    assert.equal(parseExifDate("2024-05-01"), 20240501120000);
    // A dead clock battery, and the epoch, are not photographs from 1970.
    assert.equal(parseExifDate("0000:00:00 00:00:00"), null);
    assert.equal(parseExifDate("1970:01:01 00:00:00"), null);
  });

  test("calendar arithmetic survives leap years and month ends", () => {
    assert.equal(addDays(20240228, 1), 20240229);
    assert.equal(addDays(20250228, 1), 20250301);
    assert.equal(addDays(20251231, 1), 20260101);
    assert.equal(daysBetween(20250101, 20251231), 364);
  });

  test("weeks start on Monday", () => {
    assert.equal(weekdayOf(20250818), 0);
    assert.equal(weekdayOf(20250817), 6);
  });

  test("seconds between frames are seconds, not digits", () => {
    // 12:00:59 to 12:01:00 is one second, however the integers read.
    assert.equal(epochSecondsOf(20250101120100) - epochSecondsOf(20250101120059), 1);
    assert.equal(epochSecondsOf(20250102000000) - epochSecondsOf(20250101235959), 1);
  });

  test("days are shown the way people write them", () => {
    assert.equal(formatDay(20250312), "12 Mar 2025");
  });
});
