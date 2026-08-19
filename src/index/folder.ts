import { recordRemovals } from "./types.ts";
import { INDEX_VERSION, type Db } from "../core/db.ts";
import type { SourceConfig } from "../core/config.ts";
import { classify } from "../core/media.ts";
import { normPath, pathKey, stemOf, extOf } from "../core/paths.ts";
import { walk } from "./walk.ts";
import { enrichSource } from "./enrich.ts";
import { emptyStats, type IndexOptions, type IndexStats } from "./types.ts";

/** Directories per write transaction. Large enough to amortise fsync, small
 *  enough that a cancelled run does not lose much work. */
const BATCH_DIRECTORIES = 256;

interface CachedDir {
  id: number;
  mtimeMs: number;
}

/**
 * Indexes a folder tree.
 *
 * Two passes, deliberately separated: the walk records only what `readdir` and
 * `lstat` give (name, size, mtime), then a second pass opens the files that
 * actually need reading. That split is what makes a re-index cheap — a
 * directory whose mtime has not moved is skipped without a single `stat`, and
 * a file whose size and mtime match keeps the metadata already stored for it.
 */
export async function indexFolderSource(
  db: Db,
  source: SourceConfig,
  options: IndexOptions = {},
): Promise<IndexStats> {
  const started = performance.now();
  const stats = emptyStats();
  const mode = options.mode ?? "incremental";

  const row = db.upsertSource(source.key, source.label, "folder", normPath(source.path));
  const run = row.run + 1;

  options.onProgress?.({ phase: "starting", directories: 0, files: 0, done: 0, total: 0 });

  // Preload directory state so the walk can test "unchanged?" without a query
  // per folder. Even 100k directories is only a few MB here.
  const cache = new Map<string, CachedDir>();
  for (const dir of db.allAs<{ id: number; path_key: string; mtime_ms: number }>(
    "SELECT id, path_key, mtime_ms FROM directory WHERE source_id = ?",
    row.id,
  )) {
    cache.set(dir.path_key, { id: dir.id, mtimeMs: dir.mtime_ms });
  }

  const upsertDir = db.prep(`
    INSERT INTO directory (source_id, path, path_key, mtime_ms, entry_count, seen_run)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, path_key) DO UPDATE SET
      path        = excluded.path,
      mtime_ms    = excluded.mtime_ms,
      entry_count = excluded.entry_count,
      seen_run    = excluded.seen_run
    RETURNING id
  `);

  const touchDir = db.prep("UPDATE directory SET seen_run = ? WHERE id = ?");
  const touchPhotos = db.prep("UPDATE photo SET seen_run = ? WHERE dir_id = ?");

  const upsertPhoto = db.prep(`
    INSERT INTO photo (
      source_id, dir_id, name, name_key, stem, ext, kind, size, mtime_ms, present, seen_run, created_run
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(dir_id, name_key) DO UPDATE SET
      name     = excluded.name,
      size     = excluded.size,
      mtime_ms = excluded.mtime_ms,
      present  = 1,
      seen_run = excluded.seen_run,
      -- Cached metadata stays valid only while size and mtime hold. The stale
      -- values themselves are cleared in one sweep below, before they can be
      -- counted.
      meta_state = CASE
        WHEN photo.size = excluded.size AND photo.mtime_ms = excluded.mtime_ms THEN photo.meta_state
        ELSE 'pending'
      END
    RETURNING created_run
  `);

  type PendingDir = {
    path: string;
    mtimeMs: number;
    unchanged: boolean;
    files: Array<{ name: string; size: number; mtimeMs: number }>;
    fileCount: number;
  };
  let batch: PendingDir[] = [];

  const flush = () => {
    if (batch.length === 0) return;
    const work = batch;
    batch = [];

    db.tx(() => {
      for (const dir of work) {
        const key = pathKey(dir.path);
        const cached = cache.get(key);

        if (dir.unchanged && cached) {
          touchDir.run(run, cached.id);
          touchPhotos.run(run, cached.id);
          continue;
        }

        const inserted = upsertDir.get(
          row.id,
          dir.path,
          key,
          dir.mtimeMs,
          dir.fileCount,
          run,
        ) as { id: number };
        cache.set(key, { id: inserted.id, mtimeMs: dir.mtimeMs });

        for (const file of dir.files) {
          const ext = extOf(file.name);
          const kind = classify(file.name, ext);
          if (kind === null) continue;

          const result = upsertPhoto.get(
            row.id,
            inserted.id,
            file.name,
            file.name.toLowerCase(),
            stemOf(file.name),
            ext,
            kind,
            file.size,
            file.mtimeMs,
            run,
            run,
          ) as { created_run: number } | undefined;

          if (result && result.created_run === run) stats.added++;
        }
      }
    });
  };

  const walkResult = await walk(
    normPath(source.path),
    {
      excludeDirs: source.excludes,
      keepFile: (name, ext) => classify(name, ext) !== null,
      isUnchanged: (dirPath, mtimeMs) => {
        if (mode === "full") return false;
        const cached = cache.get(pathKey(dirPath));
        return cached !== undefined && cached.mtimeMs === mtimeMs;
      },
      ...(options.signal ? { signal: options.signal } : {}),
      onProgress: (directories, files) => {
        options.onProgress?.({
          phase: "walking",
          directories,
          files,
          done: 0,
          total: 0,
          message: "Looking for photographs",
        });
      },
    },
    (dir) => {
      batch.push(dir);
      if (batch.length >= BATCH_DIRECTORIES) flush();
    },
  );

  flush();

  stats.directories = walkResult.directories;
  stats.skippedDirectories = walkResult.skippedDirectories;
  stats.errors = walkResult.errors;

  options.onProgress?.({
    phase: "sweeping",
    directories: stats.directories,
    files: walkResult.files,
    done: 0,
    total: 0,
  });

  db.tx(() => {
    // Counted before it is deleted: this is the only moment anything knows
    // these photographs were ever here.
    recordRemovals(db, row.id, run);
    const removed = db.prep("DELETE FROM photo WHERE source_id = ? AND seen_run < ?").run(row.id, run);
    stats.removed = Number(removed.changes);
    db.prep("DELETE FROM directory WHERE source_id = ? AND seen_run < ?").run(row.id, run);

    // A file whose size or mtime moved is a different photograph now. Its old
    // numbers must not survive into the deck even if the read below is
    // interrupted before it reaches them.
    if (mode === "full") {
      db.prep("UPDATE photo SET meta_state = 'pending' WHERE source_id = ?").run(row.id);
    }
    db.prep(`
      UPDATE photo SET
        captured_at = NULL, epoch_sec = NULL, day = NULL, year = NULL, ym = NULL, weekday = NULL, hour = NULL,
        sub_sec = NULL, camera_id = NULL, lens_id = NULL, body_serial = NULL,
        focal = NULL, focal35 = NULL, aperture = NULL, shutter = NULL, iso = NULL, flash = NULL,
        width = NULL, height = NULL, orientation = NULL, lat = NULL, lon = NULL, duration = NULL,
        shot_key = NULL
      WHERE source_id = ? AND meta_state = 'pending'
    `).run(row.id);
  });

  const enriched = await enrichSource(db, row.id, {
    ...(options.signal ? { signal: options.signal } : {}),
    onProgress: ({ done, total }) =>
      options.onProgress?.({
        phase: "reading-metadata",
        directories: stats.directories,
        files: db.countPhotos(row.id),
        done,
        total,
        message: "Reading capture metadata",
      }),
  });

  stats.read = enriched.read;
  stats.errors = [...stats.errors, ...enriched.errors].slice(0, 20);
  stats.files = db.countPhotos(row.id);
  stats.withMetadata =
    db.getAs<{ n: number }>(
      "SELECT COUNT(*) AS n FROM photo WHERE source_id = ? AND meta_state = 'ok'",
      row.id,
    )?.n ?? 0;
  stats.durationMs = Math.round(performance.now() - started);

  db.prep(
    "UPDATE source SET run = ?, last_indexed_at = ?, stats = ?, index_version = ? WHERE id = ?",
  ).run(run, Date.now(), JSON.stringify(stats), INDEX_VERSION, row.id);

  options.onProgress?.({
    phase: "done",
    directories: stats.directories,
    files: stats.files,
    done: stats.read,
    total: stats.read,
  });

  return stats;
}
