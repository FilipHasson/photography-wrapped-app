import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Db } from "../src/core/db.ts";
import { defaultConfig, defaultSource, type AppConfig } from "../src/core/config.ts";
import { indexSource, indexOverview } from "../src/index/source.ts";
import { rebuildPrimaries } from "../src/index/dedupe.ts";
import { computeStats, gearCatalog } from "../src/stats/aggregate.ts";
import { buildDeck } from "../src/stats/slides.ts";
import { resolveRange } from "../src/stats/range.ts";
import { EXPECTED, makeFixtures } from "../tools/make-fixtures.ts";

/**
 * The end-to-end test: real files with real EXIF, walked, read, deduped and
 * counted. Everything the deck claims passes through here.
 */

let root = "";
let db: Db;
let config: AppConfig;

const allTime = (database: Db) => {
  const overview = indexOverview(database);
  return resolveRange({ kind: "all" }, { firstDay: overview.firstDay, lastDay: overview.lastDay });
};

const statsFor = (database: Db, range = allTime(database)) =>
  computeStats(database, range, { includeVideo: true });

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "wdis-test-"));
  await makeFixtures(path.join(root, "library"));

  db = new Db(":memory:");
  config = defaultConfig();
  const source = defaultSource({ path: path.join(root, "library"), label: "Library" });
  config.sources.push(source);

  await indexSource(db, source, config);
});

after(async () => {
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe("indexing", () => {
  test("finds every photograph and clip on disk", () => {
    const files = db.getAs<{ n: number }>("SELECT COUNT(*) AS n FROM photo WHERE present = 1")?.n;
    assert.equal(files, EXPECTED.files);
  });

  test("counts frames rather than files", () => {
    assert.equal(indexOverview(db).shots, EXPECTED.shots);
  });

  test("a raw file and its JPEG are one photograph", () => {
    const pairs = db.allAs<{ shot_key: string; n: number }>(
      "SELECT shot_key, COUNT(*) AS n FROM photo WHERE present = 1 GROUP BY shot_key HAVING n > 1",
    );
    assert.ok(pairs.length > 0, "expected some frames to have more than one file");
    for (const pair of pairs) {
      const primaries = db.getAs<{ n: number }>(
        "SELECT COUNT(*) AS n FROM photo WHERE shot_key = ? AND is_primary = 1",
        pair.shot_key,
      );
      assert.equal(primaries?.n, 1, `${pair.shot_key} should have exactly one primary row`);
    }
  });

  test("the raw file wins over its JPEG", () => {
    const kinds = db.allAs<{ kind: string; n: number }>(
      `SELECT kind, COUNT(*) AS n FROM photo
       WHERE is_primary = 1 AND present = 1 AND shot_key IN (
         SELECT shot_key FROM photo WHERE present = 1 GROUP BY shot_key HAVING COUNT(*) > 1
       ) GROUP BY kind`,
    );
    assert.deepEqual(
      kinds.map((row) => ({ kind: row.kind, n: row.n })),
      [{ kind: "raw", n: 10 }],
    );
  });

  test("a backup copy at another path is not another photograph", () => {
    const copies = db.getAs<{ n: number }>(
      "SELECT COUNT(*) AS n FROM photo p JOIN directory d ON d.id = p.dir_id WHERE d.path LIKE '%backup%'",
    );
    assert.equal(copies?.n, 5, "the copies should still be indexed");

    const counted = db.getAs<{ n: number }>(
      `SELECT COUNT(*) AS n FROM photo p JOIN directory d ON d.id = p.dir_id
       WHERE d.path LIKE '%backup%' AND p.is_primary = 1`,
    );
    assert.equal(counted?.n, 0, "but none of them should count");
  });

  test("counting files instead of frames is one setting away", () => {
    rebuildPrimaries(db, { mergeRawJpegPairs: false });
    assert.equal(indexOverview(db).shots, EXPECTED.shotsUnmerged);
    rebuildPrimaries(db, { mergeRawJpegPairs: true });
    assert.equal(indexOverview(db).shots, EXPECTED.shots);
  });

  test("re-indexing opens no files and changes nothing", async () => {
    const stats = await indexSource(db, config.sources[0] as never, config);
    assert.equal(stats.read, 0, "an unchanged library should re-read no headers");
    assert.equal(stats.added, 0);
    assert.equal(indexOverview(db).shots, EXPECTED.shots);
  });
});

describe("gear", () => {
  test("names the most-used camera", () => {
    const stats = statsFor(db);
    assert.equal(stats.cameras[0]?.label, EXPECTED.topCamera);
    assert.equal(stats.cameras[0]?.shots, EXPECTED.topCameraShots);
    assert.equal(stats.totals.cameras, EXPECTED.cameras);
  });

  test("names the most-used lens", () => {
    const stats = statsFor(db);
    assert.equal(stats.lenses[0]?.label, EXPECTED.topLens);
    assert.equal(stats.lenses[0]?.shots, EXPECTED.topLensShots);
    assert.equal(stats.totals.lenses, EXPECTED.lenses);
  });

  test("names the most-used body and lens pairing", () => {
    const stats = statsFor(db);
    const top = stats.combos[0];
    assert.ok(top, "expected a pairing");
    assert.equal(top.shots, EXPECTED.topCombo);
    assert.ok(top.label.includes(EXPECTED.topCamera), `"${top.label}" should name the camera`);
    assert.ok(top.label.includes("24-70"), `"${top.label}" should name the lens`);
  });

  test("a clip's camera is the same body as its stills", () => {
    const rows = db.allAs<{ label: string; n: number }>(
      `SELECT c.label AS label, COUNT(*) AS n FROM photo p JOIN camera c ON c.id = p.camera_id
       WHERE p.kind = 'video' GROUP BY c.id`,
    );
    assert.deepEqual(
      rows.map((row) => ({ label: row.label, n: row.n })),
      [{ label: "Nikon Z 8", n: EXPECTED.videos }],
    );
  });
});

describe("teleconverters", () => {
  test("a converted frame keeps the lens it was taken with", () => {
    const stats = statsFor(db);
    const tele = stats.lenses.find((lens) => lens.label.includes("70-200"));
    assert.ok(tele, "expected the telephoto in the list");

    // One row, not two: six frames on one lens, two of them through a 1.4x.
    assert.equal(tele.shots, 6);
    assert.deepEqual(tele.parts, [
      { tc: null, shots: 4 },
      { tc: "1.4x", shots: 2 },
    ]);
  });

  test("the converter is recorded on the frame", () => {
    const rows = db.allAs<{ tc: string | null; n: number }>(
      "SELECT tc, COUNT(*) AS n FROM photo WHERE is_primary = 1 AND tc IS NOT NULL GROUP BY tc",
    );
    assert.deepEqual(
      rows.map((row) => ({ tc: row.tc, n: row.n })),
      [{ tc: "1.4x", n: EXPECTED.teleconverted }],
    );
  });

  test("the lens count is unchanged by it", () => {
    assert.equal(statsFor(db).totals.lenses, EXPECTED.lenses);
  });
});

/**
 * What the milestone picker offers. One row per thing you own, whatever it has
 * been called across sources — and a converter as an item of its own, because
 * buying a 1.4x is its own purchase.
 */
describe("the gear catalog", () => {
  test("lists every body and every lens exactly once", () => {
    const catalog = gearCatalog(db);

    assert.equal(catalog.cameras.length, EXPECTED.cameras);
    assert.equal(catalog.lenses.length, EXPECTED.lenses);

    const keys = [...catalog.cameras, ...catalog.lenses].map((item) => item.key);
    assert.equal(new Set(keys).size, keys.length, "a key appeared twice");
  });

  test("a teleconverter is an item of its own, and says what it was on", () => {
    const catalog = gearCatalog(db);

    assert.equal(catalog.teleconverters.length, 1);
    const [converter] = catalog.teleconverters;
    assert.equal(converter?.key, "1.4x");
    assert.equal(converter?.shots, EXPECTED.teleconverted);
    assert.match(String(converter?.note), /70-200/);

    // And it is not also a lens: the glass in front of it is one row, whether
    // the converter was on the back of it or not.
    assert.equal(catalog.lenses.filter((lens) => lens.key.includes("14x")).length, 0);
  });

  test("names follow the reader's naming options", () => {
    const short = gearCatalog(db, { lensStyle: "short", showMake: true });
    const written = gearCatalog(db, { lensStyle: "full", showMake: true });

    assert.ok(short.lenses.some((lens) => lens.label === EXPECTED.topLens));
    assert.ok(written.lenses.some((lens) => lens.label.includes("f/2.8")));

    // The keys are the same list either way — a display setting must never
    // move what a milestone points at.
    assert.deepEqual(
      short.lenses.map((lens) => lens.key),
      written.lenses.map((lens) => lens.key),
    );
  });

  test("says when each thing was first and last used", () => {
    const camera = gearCatalog(db).cameras.find((item) => item.label === EXPECTED.topCamera);
    assert.ok(camera);
    assert.ok(camera.firstDay && camera.lastDay && camera.firstDay <= camera.lastDay);
  });
});

describe("exposure", () => {
  test("snaps focal lengths onto the scale people talk in", () => {
    const stats = statsFor(db);
    assert.equal(stats.focal.favourite?.value, EXPECTED.favouriteFocal);
  });

  test("keeps crop bodies in the right angle-of-view family", () => {
    const stats = statsFor(db);
    // The 23mm frames are 35mm-equivalent, so they are normal, not wide.
    const normal = stats.focalClasses.find((entry) => entry.label === "normal");
    assert.equal(normal?.shots, 8);
  });

  test("finds the favourite aperture", () => {
    const stats = statsFor(db);
    assert.equal(stats.aperture.favourite?.value, EXPECTED.favouriteAperture);
  });

  test("reports what it does not know", () => {
    const stats = statsFor(db);
    // The clips carry no exposure data at all, and should not be counted as
    // though they did.
    assert.equal(stats.aperture.known, EXPECTED.shots - EXPECTED.videos);
  });
});

describe("time", () => {
  test("finds the busiest day", () => {
    const stats = statsFor(db);
    assert.equal(stats.busiestDay?.day, EXPECTED.busiestDay);
    assert.equal(stats.busiestDay?.shots, EXPECTED.busiestDayShots);
    assert.equal(stats.totals.daysShot, EXPECTED.daysShot);
  });

  test("a year excludes the year before it", () => {
    const stats = computeStats(db, resolveRange({ kind: "year", year: 2025 }, { firstDay: null, lastDay: null }, new Date()), {
      includeVideo: true,
    });
    assert.equal(stats.totals.shots, EXPECTED.shots2025);
  });

  test("a month is a month", () => {
    const stats = computeStats(
      db,
      resolveRange({ kind: "month", year: 2025, month: 3 }, { firstDay: null, lastDay: null }, new Date()),
      { includeVideo: true },
    );
    assert.equal(stats.totals.shots, EXPECTED.shotsMarch2025);
  });

  test("finds the longest burst", () => {
    const stats = statsFor(db);
    assert.equal(stats.burst?.frames, EXPECTED.longestBurst);
  });

  test("clips can be left out entirely", () => {
    const stats = computeStats(db, allTime(db), { includeVideo: false });
    assert.equal(stats.totals.shots, EXPECTED.shots - EXPECTED.videos);
  });
});

describe("hiding gear that skews the numbers", () => {
  // The case: one iPhone frame imported into a catalog is a whole camera as
  // far as the data is concerned. Here it is the Fuji standing in for it.
  const hidden = { includeVideo: true, excluded: { cameras: ["xt5"], lenses: [] } };

  test("its frames leave every count", () => {
    const before = statsFor(db);
    const after = computeStats(db, allTime(db), hidden);

    assert.equal(after.totals.shots, before.totals.shots - 8);
    assert.equal(after.totals.cameras, before.totals.cameras - 1);
    // And it is gone from the lens counts too, not only from its own slide.
    assert.equal(after.lenses.length, before.lenses.length - 1);
  });

  test("but it stays listed, so it can come back", () => {
    const after = computeStats(db, allTime(db), hidden);

    assert.equal(after.cameras.length, 1);
    assert.equal(after.hiddenCameras.length, 1);
    assert.equal(after.hiddenCameras[0]?.label, "Fujifilm X-T5");
    assert.equal(after.hiddenCameras[0]?.shots, 8, "counted as if it were not hidden");
    assert.equal(after.hiddenCameras[0]?.excluded, true);
  });

  test("hiding something absent changes nothing", () => {
    const after = computeStats(db, allTime(db), {
      includeVideo: true,
      excluded: { cameras: ["no-such-camera"], lenses: [] },
    });
    assert.equal(after.totals.shots, EXPECTED.shots);
    assert.equal(after.hiddenCameras.length, 0);
  });

  test("frames with no camera recorded are not swept up with it", () => {
    // Excluding a camera must not also exclude everything unattributed.
    const after = computeStats(db, allTime(db), hidden);
    const attributed = after.cameras.reduce((sum, row) => sum + row.shots, 0);
    assert.equal(attributed, after.totals.shots);
  });
});

describe("the rest of it", () => {
  test("reads GPS from the frames that carry it", () => {
    const stats = statsFor(db);
    assert.equal(stats.totals.withGps, EXPECTED.withGps);
    assert.ok(stats.places.length > 0);
    assert.ok(Math.abs((stats.places[0]?.lat ?? 0) - 59.3) < 0.2);
  });

  test("counts clips and their runtime", () => {
    const stats = statsFor(db);
    assert.equal(stats.totals.videos, EXPECTED.videos);
    assert.equal(stats.totals.videoSeconds, EXPECTED.videoSeconds);
  });

  test("knows which way up a frame is", () => {
    const stats = statsFor(db);
    // The Fuji frames were shot upright; everything else was not.
    assert.equal(stats.orientation.portrait, 8);
    assert.equal(stats.orientation.landscape, EXPECTED.shots - EXPECTED.videos - 8);
  });

  test("builds a deck that says what it counted", () => {
    const deck = buildDeck(statsFor(db), "Filip");
    assert.equal(deck.empty, false);
    assert.ok(deck.slides.length >= 8, `expected a full deck, got ${deck.slides.length} slides`);

    const opening = deck.slides[0];
    assert.equal(opening?.id, "opening");
    assert.ok(opening.headline.includes("29"), opening.headline);

    // Every slide has to be readable as a table, not only as a picture.
    for (const slide of deck.slides) {
      assert.ok(slide.table.columns.length > 0, `${slide.id} has no table columns`);
      assert.ok(slide.table.rows.length > 0, `${slide.id} has no table rows`);
    }
  });

  test("an empty range says so rather than inventing numbers", () => {
    const range = resolveRange({ kind: "year", year: 1999 }, { firstDay: null, lastDay: null }, new Date());
    const deck = buildDeck(computeStats(db, range, { includeVideo: true }));
    assert.equal(deck.empty, true);
    assert.equal(deck.slides.length, 1);
    assert.equal(deck.slides[0]?.headline, "Nothing here yet");
  });
});


/**
 * A photograph deleted from a library leaves nothing behind in it — the row is
 * simply not there next time. The sweep is the one moment anything can notice,
 * so it counts what it is about to delete, split by how it was flagged.
 */
describe("what leaves the library", () => {
  test("is counted on the way out, by flag", async () => {
    const library = path.join(root, "removals");
    await makeFixtures(library);

    const fresh = new Db(":memory:");
    const own = defaultConfig();
    const source = defaultSource({ path: library, label: "Removals" });
    own.sources = [source];
    await indexSource(fresh, source, own);

    // Flag three frames as rejects, one as a pick, then delete two rejects and
    // the pick from disk — exactly what culling in Lightroom then emptying the
    // trash looks like from here.
    const files = fresh
      .allAs<{ id: number; name: string }>("SELECT id, name FROM photo ORDER BY name LIMIT 4")
      .map((row) => row);
    for (const [i, file] of files.entries()) {
      fresh.prep("UPDATE photo SET pick = ? WHERE id = ?").run(i === 3 ? 1 : -1, file.id);
    }

    const gone = [files[0], files[1], files[3]];
    for (const file of gone) {
      const row = fresh.getAs<{ path: string }>(
        "SELECT d.path || '/' || p.name AS path FROM photo p JOIN directory d ON d.id = p.dir_id WHERE p.id = ?",
        file!.id,
      );
      await fs.rm(row!.path, { force: true });
    }

    await indexSource(fresh, source, own);

    const removals = fresh.allAs<{ removed: number; rejected: number; picked: number }>(
      "SELECT removed, rejected, picked FROM removal",
    );
    assert.equal(removals.length, 1, "one sweep, one row");
    assert.equal(removals[0]?.removed, 3);
    assert.equal(removals[0]?.rejected, 2);
    assert.equal(removals[0]?.picked, 1);

    // And nothing is written when nothing went.
    await indexSource(fresh, source, own);
    assert.equal(fresh.allAs("SELECT id FROM removal").length, 1, "a quiet sweep records nothing");

    fresh.close();
  });
});
