import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Db, gainsSince, INDEX_VERSION } from "../src/core/db.ts";
import { repairIndex } from "../src/index/repair.ts";

/**
 * Two ways an index catches up with code that changed under it.
 *
 * `repair` is for what can be fixed in place, and it has to be, because the
 * alternative is asking someone to re-read two hundred thousand files. The
 * version is for what cannot: it marks a source as behind and says what a
 * re-index would add, rather than pretending nothing changed.
 */

/** An index as the old code would have left it: converters inside lens names. */
function oldIndex(): Db {
  const db = new Db(":memory:");
  const source = db.upsertSource("cat", "Catalog", "lightroom", "C:/x.lrcat");

  db.prep("INSERT INTO directory (id, source_id, path, path_key) VALUES (1, ?, 'C:/x', 'c:/x')").run(
    source.id,
  );

  const lens = (id: number, key: string, label: string) =>
    db.prep("INSERT INTO lens (id, key, label, make, model) VALUES (?, ?, ?, '', ?)").run(id, key, label, label);

  lens(1, "fe200600mmf5663goss", "FE 200-600mm F5.6-6.3 G OSS");
  lens(2, "fe200600mmf5663goss14xteleconverter", "FE 200-600mm F5.6-6.3 G OSS + 1.4X Teleconverter");
  lens(3, "fe200600mmf5663goss2xteleconverter", "FE 200-600mm F5.6-6.3 G OSS + 2X Teleconverter");
  // A lens only ever used behind a converter, which has no bare row to join.
  lens(4, "fe600mmf4gmoss2xteleconverter", "FE 600mm F4 GM OSS + 2X Teleconverter");

  let id = 0;
  const add = (lensId: number, count: number) => {
    for (let i = 0; i < count; i++) {
      id++;
      db.prep(
        `INSERT INTO photo (id, source_id, dir_id, name, name_key, stem, ext, kind, size, mtime_ms, seen_run, lens_id, day, captured_at)
         VALUES (?, ?, 1, ?, ?, ?, 'arw', 'raw', 100, 0, 1, ?, 20250101, 20250101120000)`,
      ).run(id, source.id, `DSC${id}.ARW`, `dsc${id}.arw`, `dsc${id}`, lensId);
    }
  };

  add(1, 10);
  add(2, 4);
  add(3, 2);
  add(4, 3);
  return db;
}

describe("repairing an index built by older code", () => {
  test("folds converter rows back into the lens they belong to", () => {
    const db = oldIndex();
    const result = repairIndex(db);
    assert.equal(result.teleconverters, 3);

    const lenses = db.allAs<{ key: string; label: string; n: number }>(
      `SELECT l.key AS key, l.label AS label, COUNT(*) AS n
       FROM photo p JOIN lens l ON l.id = p.lens_id GROUP BY l.id ORDER BY n DESC`,
    );

    // The 200-600 is one lens again: ten bare frames plus six converted.
    assert.equal(lenses.length, 2, "two lenses, not four");
    assert.equal(lenses[0]?.n, 16);
    assert.equal(lenses[0]?.label, "FE 200-600mm F5.6-6.3 G OSS");

    // The one that was only ever used with a converter keeps its frames and
    // loses the converter from its name.
    assert.equal(lenses[1]?.n, 3);
    assert.equal(lenses[1]?.label, "FE 600mm F4 GM OSS");
    db.close();
  });

  test("records which converter each frame was taken through", () => {
    const db = oldIndex();
    repairIndex(db);

    const split = db.allAs<{ tc: string | null; n: number }>(
      "SELECT tc, COUNT(*) AS n FROM photo GROUP BY tc ORDER BY n DESC",
    );
    assert.deepEqual(
      split.map((row) => ({ tc: row.tc, n: row.n })),
      [
        { tc: null, n: 10 },
        { tc: "2x", n: 5 },
        { tc: "1.4x", n: 4 },
      ],
    );
    db.close();
  });

  test("running it again does nothing", () => {
    const db = oldIndex();
    repairIndex(db);

    const before = db.allAs("SELECT id, key, label FROM lens ORDER BY id");
    assert.equal(repairIndex(db).teleconverters, 0);
    assert.deepEqual(db.allAs("SELECT id, key, label FROM lens ORDER BY id"), before);
    db.close();
  });

  test("an index with nothing to fix is left alone", () => {
    const db = new Db(":memory:");
    assert.equal(repairIndex(db).teleconverters, 0);
    db.close();
  });
});

describe("index versions", () => {
  test("a source built by older code is marked, with a reason", () => {
    // Version 0 is every source indexed before versions existed.
    assert.ok(gainsSince(0).length > 0, "a version 0 source should have something to gain");
    assert.ok(gainsSince(0).some((gain) => gain.includes("teleconverter")));
  });

  test("a source built by this code is current", () => {
    assert.deepEqual(gainsSince(INDEX_VERSION), []);
  });

  test("indexing stamps the version it wrote", () => {
    const db = new Db(":memory:");
    const source = db.upsertSource("s", "S", "folder", "C:/photos");
    // Fresh rows start at 0 and are stamped when a run finishes.
    assert.equal(db.getSource("s")?.index_version, 0);

    db.prep("UPDATE source SET index_version = ? WHERE id = ?").run(INDEX_VERSION, source.id);
    assert.equal(db.getSource("s")?.index_version, INDEX_VERSION);
    assert.deepEqual(gainsSince(db.getSource("s")?.index_version ?? 0), []);
    db.close();
  });
});
