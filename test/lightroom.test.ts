import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Db } from "../src/core/db.ts";
import { defaultConfig, defaultSource, type AppConfig, type SourceConfig } from "../src/core/config.ts";
import { indexSource, indexOverview } from "../src/index/source.ts";
import { rebuildPrimaries } from "../src/index/dedupe.ts";
import { computeStats } from "../src/stats/aggregate.ts";
import { resolveRange } from "../src/stats/range.ts";
import { EXPECTED, makeFixtures } from "../tools/make-fixtures.ts";
import { makeCatalog, type CatalogEntry } from "../tools/make-catalog.ts";

/**
 * A folder and the catalog that indexed it, both added at once.
 *
 * This is the ordinary case — people have a Pictures folder *and* a Lightroom
 * catalog pointing at it — and the one where counting goes wrong most easily.
 * Every frame is described twice, by two sources that know different things
 * about it, and the deck has to end up with one of each.
 */

let root = "";
let library = "";
let db: Db;
let config: AppConfig;
let folderSource: SourceConfig;
let catalogSource: SourceConfig;

/** The catalog knows the ten raw frames from the morning shoot, and rates them. */
function catalogEntries(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  const root35 = `${library.split(path.sep).join("/")}/`;

  for (let i = 0; i < 10; i++) {
    entries.push({
      root: root35,
      folder: "2025/03-15/morning/",
      baseName: `DSC_${String(2000 + i).padStart(4, "0")}`,
      extension: "NEF",
      captureTime: `2025-03-15T10:00:${String(i).padStart(2, "0")}`,
      cameraModel: "NIKON Z 8",
      cameraSerial: "Z8-000121",
      lens: "NIKKOR Z 24-70mm f/2.8 S",
      focalLength: 24,
      aperture: 2.8,
      shutter: 1 / 250,
      iso: 200,
      // Five keepers, five not.
      rating: i < 5 ? 5 : 1,
      width: 8256,
      height: 5504,
      latitude: 59.3293,
      longitude: 18.0686,
    });
  }

  // One frame the catalog remembers and the disk does not — deleted, archived,
  // or on a drive that is not plugged in.
  entries.push({
    root: root35,
    folder: "2025/03-15/morning/",
    baseName: "DSC_9999",
    extension: "NEF",
    captureTime: "2025-03-15T11:30:00",
    cameraModel: "NIKON Z 8",
    cameraSerial: "Z8-000121",
    lens: "NIKKOR Z 24-70mm f/2.8 S",
    focalLength: 50,
    aperture: 1.8,
    shutter: 1 / 500,
    iso: 64,
    rating: 4,
  });

  return entries;
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "wdis-lrcat-"));
  library = path.join(root, "library");
  await makeFixtures(library);

  const catalogPath = path.join(root, "Photos.lrcat");
  await makeCatalog(catalogPath, catalogEntries());

  db = new Db(":memory:");
  config = defaultConfig();
  folderSource = defaultSource({ path: library, label: "Library" });
  catalogSource = defaultSource({ path: catalogPath, label: "Catalog" });
  config.sources.push(folderSource, catalogSource);

  await indexSource(db, folderSource, config);
  await indexSource(db, catalogSource, config);
});

after(async () => {
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});

const stats = () => {
  const overview = indexOverview(db);
  return computeStats(
    db,
    resolveRange({ kind: "all" }, { firstDay: overview.firstDay, lastDay: overview.lastDay }),
    { includeVideo: true },
  );
};

describe("a Lightroom catalog", () => {
  test("is read without Lightroom, and without opening a photograph", () => {
    const source = db.getSource(catalogSource.key);
    assert.ok(source, "the catalog should have been indexed");

    const rows = db.getAs<{ n: number }>(
      "SELECT COUNT(*) AS n FROM photo WHERE source_id = ?",
      source.id,
    );
    assert.equal(rows?.n, 11);

    const withMetadata = db.getAs<{ n: number }>(
      "SELECT COUNT(*) AS n FROM photo WHERE source_id = ? AND meta_state = 'ok'",
      source.id,
    );
    assert.equal(withMetadata?.n, 11, "every catalog row arrives complete");
  });

  test("does not count the same photographs twice", () => {
    // Ten frames the catalog and the folder both describe, plus the one only
    // the catalog remembers.
    assert.equal(indexOverview(db).shots, EXPECTED.shots + 1);
  });

  test("still folds a raw file together with its JPEG across sources", () => {
    // The catalog row wins the raw file's path, and has no sub-second time —
    // if the frame key leaned on that, these ten would each count twice.
    const morning = db.getAs<{ n: number }>(
      `SELECT COUNT(*) AS n FROM photo p JOIN directory d ON d.id = p.dir_id
       WHERE p.is_primary = 1 AND d.path LIKE '%morning%'`,
    );
    assert.equal(morning?.n, 11);
  });

  test("reads exposure back out of the catalog's logarithms", () => {
    const row = db.getAs<{ aperture: number; shutter: number; iso: number; focal: number }>(
      `SELECT aperture, shutter, iso, focal FROM photo
       WHERE source_id = (SELECT id FROM source WHERE key = ?) AND name_key = 'dsc_2000.nef'`,
      catalogSource.key,
    );
    assert.ok(row, "expected the catalog's copy of the frame");
    assert.ok(Math.abs(row.aperture - 2.8) < 0.02, `aperture came back as ${row.aperture}`);
    assert.ok(Math.abs(row.shutter - 1 / 250) < 0.0001, `shutter came back as ${row.shutter}`);
    assert.equal(row.iso, 200);
    assert.equal(row.focal, 24);
  });

  test("gives the ratings to the row that survived", () => {
    const rated = db.getAs<{ n: number }>(
      "SELECT COUNT(*) AS n FROM photo WHERE is_primary = 1 AND rating IS NOT NULL",
    );
    assert.equal(rated?.n, 11);

    const keepers = stats().totals.keepers;
    assert.equal(keepers, 6, "five five-star frames plus the four-star one");
  });

  test("keeps one camera and one lens, however the two sources spell them", () => {
    const current = stats();
    assert.equal(current.totals.cameras, EXPECTED.cameras);
    assert.equal(current.totals.lenses, EXPECTED.lenses);
    assert.equal(current.cameras[0]?.label, EXPECTED.topCamera);
    assert.equal(current.lenses[0]?.label, EXPECTED.topLens);
  });

  test("counting is restored when the catalog is removed", () => {
    db.deleteSource(catalogSource.key);
    rebuildPrimaries(db, { mergeRawJpegPairs: true });

    assert.equal(indexOverview(db).shots, EXPECTED.shots);
    const rated = db.getAs<{ n: number }>(
      "SELECT COUNT(*) AS n FROM photo WHERE is_primary = 1 AND rating IS NOT NULL",
    );
    assert.equal(rated?.n, 0, "ratings came from the catalog and leave with it");
  });
});
