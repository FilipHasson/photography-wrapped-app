import { DatabaseSync } from "node:sqlite";
import type { StatementSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { dbFile } from "./paths.ts";
import type { GearName } from "./gear.ts";

/**
 * One SQLite file holding every source's photographs, flattened for counting.
 *
 * The schema is shaped by what a slide asks for. Everything a query groups by —
 * day, year, month, weekday, hour — is stored as its own integer column rather
 * than derived at query time, because `GROUP BY` over a computed expression
 * cannot use an index and these decks group over a million rows.
 *
 * Camera and lens names are interned into their own tables: the same forty
 * strings repeat across every row, and joining two small tables costs less than
 * comparing text a million times.
 */

/**
 * The version of the index *format*.
 *
 * Bumped whenever a change means the rows already written are missing something
 * only a re-read can supply — a new column filled from a file's metadata, or a
 * different way of deriving one. Every source records the version it was built
 * under, so the page can say which are behind and what re-indexing would buy.
 *
 * It is deliberately not bumped for changes that can be applied to rows already
 * written: those belong in `index/repair.ts`, which runs at startup and costs
 * nobody an hour of reading headers.
 */
export const INDEX_VERSION = 2;

/** What a re-index gains, listed against the version that introduced it. */
export const INDEX_CHANGES: ReadonlyArray<{ version: number; gains: string }> = [
  {
    version: 2,
    gains: "teleconverters read from each frame, and gear names kept exactly as the camera wrote them",
  },
];

/** The reasons a source built at `version` is worth re-indexing. */
export function gainsSince(version: number): string[] {
  return INDEX_CHANGES.filter((change) => change.version > version).map((change) => change.gains);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source (
  id              INTEGER PRIMARY KEY,
  key             TEXT NOT NULL UNIQUE,
  label           TEXT NOT NULL,
  kind            TEXT NOT NULL,
  root            TEXT NOT NULL,
  run             INTEGER NOT NULL DEFAULT 0,
  last_indexed_at INTEGER,
  stats           TEXT,
  index_version   INTEGER NOT NULL DEFAULT 0
);

-- What left the library, and when.
--
-- A photograph deleted from a catalog leaves no trace in it: the row is simply
-- not there the next time it is read, and the sweep used to delete our copy
-- without a word. Culling *is* photography, though — a rejected frame is a
-- decision — so the sweep now counts what it removes, split by how it was
-- flagged, before it removes it. Counts only: nothing is kept about a
-- photograph the reader has thrown away.
CREATE TABLE IF NOT EXISTS removal (
  id        INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  run       INTEGER NOT NULL,
  at        INTEGER NOT NULL,
  removed   INTEGER NOT NULL,
  rejected  INTEGER NOT NULL DEFAULT 0,
  picked    INTEGER NOT NULL DEFAULT 0,
  unflagged INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS directory (
  id          INTEGER PRIMARY KEY,
  source_id   INTEGER NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  path_key    TEXT NOT NULL,
  mtime_ms    INTEGER NOT NULL DEFAULT 0,
  entry_count INTEGER NOT NULL DEFAULT 0,
  seen_run    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (source_id, path_key)
);

CREATE TABLE IF NOT EXISTS camera (
  id    INTEGER PRIMARY KEY,
  key   TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  make  TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS lens (
  id    INTEGER PRIMARY KEY,
  key   TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  make  TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS photo (
  id          INTEGER PRIMARY KEY,
  source_id   INTEGER NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  dir_id      INTEGER NOT NULL REFERENCES directory(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  name_key    TEXT NOT NULL,
  stem        TEXT NOT NULL,
  ext         TEXT NOT NULL,
  kind        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  mtime_ms    INTEGER NOT NULL,
  present     INTEGER NOT NULL DEFAULT 1,
  seen_run    INTEGER NOT NULL,
  -- Set on insert and never updated, so a run can tell new files from ones it
  -- merely re-confirmed.
  created_run INTEGER NOT NULL DEFAULT 0,
  meta_state  TEXT NOT NULL DEFAULT 'pending',

  -- Naive wall clock, split out for grouping. See core/time.ts.
  captured_at INTEGER,
  -- The same instant as seconds, so gaps between frames are arithmetic.
  epoch_sec   INTEGER,
  day         INTEGER,
  year        INTEGER,
  ym          INTEGER,
  weekday     INTEGER,
  hour        INTEGER,
  sub_sec     INTEGER,

  camera_id   INTEGER REFERENCES camera(id),
  lens_id     INTEGER REFERENCES lens(id),
  -- The teleconverter, if any, kept beside the lens rather than inside its
  -- name: a 200-600 with a 1.4x on the back is the same lens used differently.
  tc          TEXT,
  body_serial TEXT,

  focal       REAL,
  focal35     REAL,
  aperture    REAL,
  shutter     REAL,
  iso         INTEGER,
  flash       INTEGER,
  width       INTEGER,
  height      INTEGER,
  orientation INTEGER,
  lat         REAL,
  lon         REAL,
  duration    REAL,
  rating      INTEGER,
  pick        INTEGER,
  color_label TEXT,

  -- Identity of the *frame*, not the file: a raw and its out-of-camera JPEG
  -- share one. See index/dedupe.ts for why counting files would be wrong.
  shot_key    TEXT,
  is_primary  INTEGER NOT NULL DEFAULT 1,

  UNIQUE (dir_id, name_key)
);

-- Every slide filters on exactly this predicate, so the index carries it.
CREATE INDEX IF NOT EXISTS idx_photo_day    ON photo (day) WHERE is_primary = 1 AND present = 1 AND day IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_photo_sweep  ON photo (source_id, seen_run);
CREATE INDEX IF NOT EXISTS idx_photo_shot   ON photo (shot_key) WHERE shot_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_photo_meta   ON photo (source_id, meta_state);
`;

export interface SourceRow {
  id: number;
  key: string;
  label: string;
  kind: string;
  root: string;
  run: number;
  last_indexed_at: number | null;
  stats: string | null;
  /** The format version this source was last built under. */
  index_version: number;
}

/** What SQLite will accept as a bound parameter. */
export type Param = null | number | bigint | string | Uint8Array;

export class Db {
  readonly raw: DatabaseSync;
  #stmts = new Map<string, StatementSync>();
  #cameras = new Map<string, number>();
  #lenses = new Map<string, number>();

  constructor(file: string) {
    if (file !== ":memory:") {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    this.raw = new DatabaseSync(file);

    // WAL keeps the deck readable while a long index run writes.
    this.raw.exec("PRAGMA journal_mode = WAL");
    this.raw.exec("PRAGMA synchronous = NORMAL");
    this.raw.exec("PRAGMA foreign_keys = ON");
    this.raw.exec("PRAGMA temp_store = MEMORY");
    this.raw.exec("PRAGMA cache_size = -65536"); // ~64 MiB
    this.raw.exec("PRAGMA busy_timeout = 5000");
    this.raw.exec(SCHEMA);
    this.#migrate();
  }

  /**
   * Columns added after the first release.
   *
   * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists,
   * so anything added later has to be added here too — an index of two hundred
   * thousand photographs is not something to ask someone to rebuild because a
   * column moved.
   */
  #migrate(): void {
    const columns = (table: string) =>
      new Set(
        (this.raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
          (row) => row.name,
        ),
      );

    for (const table of ["camera", "lens"] as const) {
      const existing = columns(table);
      // The name as the camera wrote it. Labels are derived from this at query
      // time, so renaming rules and display settings apply to a library that
      // was indexed months ago without re-reading a single file.
      if (!existing.has("raw_make")) {
        this.raw.exec(`ALTER TABLE ${table} ADD COLUMN raw_make TEXT`);
      }
      if (!existing.has("raw_model")) {
        this.raw.exec(`ALTER TABLE ${table} ADD COLUMN raw_model TEXT`);
        // Rows from before this column existed hold a tidied name in `model`,
        // which is the closest thing to the original available and is what the
        // naming rules were written to accept.
        this.raw.exec(
          `UPDATE ${table} SET raw_make = make, raw_model = model WHERE raw_model IS NULL`,
        );
      }
    }

    if (!columns("photo").has("tc")) {
      this.raw.exec("ALTER TABLE photo ADD COLUMN tc TEXT");
    }

    // Sources indexed before versions existed are version 0 — which is true:
    // they predate everything the version is there to track.
    if (!columns("source").has("index_version")) {
      this.raw.exec("ALTER TABLE source ADD COLUMN index_version INTEGER NOT NULL DEFAULT 0");
    }

    // `CREATE TABLE IF NOT EXISTS` in the schema covers a new database; an
    // existing one gets the table here. No backfill is possible and none is
    // pretended: deletions before this existed were not recorded, and the
    // culling slide says what it has been watching since.
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS removal (
        id        INTEGER PRIMARY KEY,
        source_id INTEGER NOT NULL REFERENCES source(id) ON DELETE CASCADE,
        run       INTEGER NOT NULL,
        at        INTEGER NOT NULL,
        removed   INTEGER NOT NULL,
        rejected  INTEGER NOT NULL DEFAULT 0,
        picked    INTEGER NOT NULL DEFAULT 0,
        unflagged INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  /** Prepared statements are cached — an index run reuses the same few. */
  prep(sql: string): StatementSync {
    let stmt = this.#stmts.get(sql);
    if (!stmt) {
      stmt = this.raw.prepare(sql);
      this.#stmts.set(sql, stmt);
    }
    return stmt;
  }

  /**
   * Typed row access. `node:sqlite` returns `Record<string, SQLOutputValue>`,
   * which TypeScript will not narrow to a row interface — these two keep the
   * cast in one place instead of at every call site.
   */
  allAs<T>(sql: string, ...params: Param[]): T[] {
    return this.prep(sql).all(...(params as never[])) as unknown as T[];
  }

  getAs<T>(sql: string, ...params: Param[]): T | undefined {
    return this.prep(sql).get(...(params as never[])) as unknown as T | undefined;
  }

  /** Runs `fn` inside a transaction, rolling back if it throws. */
  tx<T>(fn: () => T): T {
    this.raw.exec("BEGIN");
    try {
      const out = fn();
      this.raw.exec("COMMIT");
      return out;
    } catch (err) {
      try {
        this.raw.exec("ROLLBACK");
      } catch {
        // A failed rollback means the tx already ended; the original error wins.
      }
      throw err;
    }
  }

  getMeta(key: string): string | null {
    return this.getAs<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.prep(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key, value);
  }

  // ------------------------------------------------------------ sources ----

  upsertSource(key: string, label: string, kind: string, root: string): SourceRow {
    this.prep(
      `INSERT INTO source (key, label, kind, root) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET label = excluded.label, kind = excluded.kind, root = excluded.root`,
    ).run(key, label, kind, root);
    return this.getSource(key) as SourceRow;
  }

  getSource(key: string): SourceRow | undefined {
    return this.getAs<SourceRow>("SELECT * FROM source WHERE key = ?", key);
  }

  listSources(): SourceRow[] {
    return this.allAs<SourceRow>("SELECT * FROM source ORDER BY key");
  }

  /** Drops a source and, by cascade, every directory and photo under it. */
  deleteSource(key: string): void {
    this.prep("DELETE FROM source WHERE key = ?").run(key);
    this.#cameras.clear();
    this.#lenses.clear();
  }

  countPhotos(sourceId: number): number {
    return (
      this.getAs<{ n: number }>(
        "SELECT COUNT(*) AS n FROM photo WHERE source_id = ? AND present = 1",
        sourceId,
      )?.n ?? 0
    );
  }

  // ------------------------------------------------------------- gear -----

  /**
   * Interning is memoized per process because an index run calls it once per
   * file and the answer is the same forty rows over and over.
   *
   * The label is refreshed on conflict: two sources spell the same lens
   * differently, and the last one indexed wins the display name. The key is
   * what holds the grouping together, so this only ever changes cosmetics.
   */
  internCamera(name: GearName): number {
    return this.#intern("camera", this.#cameras, name);
  }

  internLens(name: GearName): number {
    return this.#intern("lens", this.#lenses, name);
  }

  #intern(table: "camera" | "lens", cache: Map<string, number>, name: GearName): number {
    const hit = cache.get(name.key);
    if (hit !== undefined) return hit;

    const row = this.prep(
      `INSERT INTO ${table} (key, label, make, model, raw_make, raw_model) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         label = excluded.label, make = excluded.make, model = excluded.model,
         raw_make = excluded.raw_make, raw_model = excluded.raw_model
       RETURNING id`,
    ).get(
      name.key,
      name.label,
      name.make,
      name.model,
      name.raw.make,
      name.raw.model,
    ) as { id: number };

    cache.set(name.key, row.id);
    return row.id;
  }

  close(): void {
    this.#stmts.clear();
    this.#cameras.clear();
    this.#lenses.clear();
    this.raw.close();
  }
}

let shared: Db | null = null;

export function openDb(file = dbFile()): Db {
  if (!shared) shared = new Db(file);
  return shared;
}

export function closeDb(): void {
  shared?.close();
  shared = null;
}
