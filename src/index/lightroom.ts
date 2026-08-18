import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import path from "node:path";
import type { Db } from "../core/db.ts";
import type { SourceConfig } from "../core/config.ts";
import { classify } from "../core/media.ts";
import { normalizeCamera, normalizeLens, cleanField } from "../core/gear.ts";
import { apexToAperture, apexToShutter } from "../core/units.ts";
import { dayOf, epochSecondsOf, hourOf, parseExifDate, weekdayOf, yearMonthOf, yearOf } from "../core/time.ts";
import { cacheDir, extOf, normPath, pathKey, stemOf } from "../core/paths.ts";
import { shotKeyFor } from "./enrich.ts";
import { emptyStats, type IndexOptions, type IndexStats } from "./types.ts";

/**
 * Reads a Lightroom Classic catalog directly.
 *
 * Worth the trouble for two reasons. It hands over camera, lens, focal length,
 * aperture, shutter, ISO and GPS for every photograph without opening a single
 * file — a catalog of 200,000 images indexes in seconds where a folder scan
 * would spend an hour reading headers. And it is the only place ratings and
 * flags live, which is what makes a "keeper rate" slide possible at all.
 *
 * Catalog schemas drift between Lightroom versions, so every optional table and
 * column is probed before use and simply contributes less when absent.
 */

const BATCH_ROWS = 2000;

interface CatalogRow {
  rootPath: string | null;
  subPath: string | null;
  baseName: string | null;
  extension: string | null;
  captureTime?: string | null;
  rating?: number | null;
  pick?: number | null;
  colorLabels?: string | null;
  fileFormat?: string | null;
  orientation?: string | null;
  fileWidth?: number | null;
  fileHeight?: number | null;
  cameraModel?: string | null;
  cameraSerial?: string | null;
  lensModel?: string | null;
  focalLength?: number | null;
  aperture?: number | null;
  shutterSpeed?: number | null;
  isoSpeedRating?: number | null;
  flashFired?: number | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
}

/**
 * Lightroom stores orientation as a letter pair naming the corner the original
 * top-left ends up in. Only the four unmirrored cases matter for counting
 * portrait against landscape.
 */
const ORIENTATION_CODES: Record<string, number> = { AB: 1, BC: 6, CD: 3, DA: 8 };

function isSafeIdent(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function tableExists(cat: DatabaseSync, name: string): boolean {
  return (
    cat.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  );
}

function tableColumns(cat: DatabaseSync, name: string): Set<string> {
  if (!isSafeIdent(name)) return new Set();
  try {
    const rows = cat.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>;
    return new Set(rows.map((r) => r.name));
  } catch {
    return new Set();
  }
}

/**
 * Lightroom keeps the catalog open and locked while running. Work on a copy —
 * including the WAL, or we would silently read a stale snapshot.
 */
async function copyCatalog(source: string): Promise<{ file: string; cleanup: () => Promise<void> }> {
  const dir = path.join(cacheDir(), "lrcat");
  await fs.mkdir(dir, { recursive: true });

  const target = path.join(dir, `${path.basename(source)}.${process.pid}.copy`);
  await fs.copyFile(source, target);

  const sidecars: string[] = [];
  for (const suffix of ["-wal", "-shm"]) {
    try {
      await fs.copyFile(`${source}${suffix}`, `${target}${suffix}`);
      sidecars.push(`${target}${suffix}`);
    } catch {
      // Absent when the catalog is not in WAL mode or is cleanly closed.
    }
  }

  return {
    file: target,
    cleanup: async () => {
      for (const f of [target, ...sidecars]) {
        await fs.rm(f, { force: true }).catch(() => {});
      }
    },
  };
}

function openCatalog(file: string): DatabaseSync {
  try {
    return new DatabaseSync(file, { readOnly: true });
  } catch {
    // A WAL catalog copied without a usable -shm cannot open read-only. It is
    // our own throwaway copy, so opening it writable is harmless.
    return new DatabaseSync(file);
  }
}

function buildQuery(cat: DatabaseSync): string {
  const select: string[] = [
    "rf.absolutePath AS rootPath",
    "fo.pathFromRoot AS subPath",
    "fi.baseName AS baseName",
    "fi.extension AS extension",
  ];
  const joins: string[] = [
    "JOIN AgLibraryFolder fo ON fo.id_local = fi.folder",
    "JOIN AgLibraryRootFolder rf ON rf.id_local = fo.rootFolder",
  ];
  const where: string[] = [];

  if (tableExists(cat, "Adobe_images")) {
    const imageCols = tableColumns(cat, "Adobe_images");
    joins.push("LEFT JOIN Adobe_images im ON im.rootFile = fi.id_local");

    for (const column of [
      "captureTime", "rating", "pick", "colorLabels", "fileFormat",
      "orientation", "fileWidth", "fileHeight",
    ]) {
      if (imageCols.has(column)) select.push(`im.${column} AS ${column}`);
    }
    // Virtual copies share a master and would otherwise count twice.
    if (imageCols.has("masterImage")) where.push("im.masterImage IS NULL");

    if (tableExists(cat, "AgHarvestedExifMetadata")) {
      const exifCols = tableColumns(cat, "AgHarvestedExifMetadata");
      joins.push("LEFT JOIN AgHarvestedExifMetadata hm ON hm.image = im.id_local");

      for (const column of [
        "focalLength", "aperture", "shutterSpeed", "isoSpeedRating",
        "flashFired", "gpsLatitude", "gpsLongitude",
      ]) {
        if (exifCols.has(column)) select.push(`hm.${column} AS ${column}`);
      }

      if (exifCols.has("cameraModelRef") && tableExists(cat, "AgInternedExifCameraModel")) {
        select.push("cm.value AS cameraModel");
        joins.push("LEFT JOIN AgInternedExifCameraModel cm ON cm.id_local = hm.cameraModelRef");
      }
      if (exifCols.has("cameraSNRef") && tableExists(cat, "AgInternedExifCameraSN")) {
        select.push("sn.value AS cameraSerial");
        joins.push("LEFT JOIN AgInternedExifCameraSN sn ON sn.id_local = hm.cameraSNRef");
      }
      if (exifCols.has("lensRef") && tableExists(cat, "AgInternedExifLens")) {
        select.push("ln.value AS lensModel");
        joins.push("LEFT JOIN AgInternedExifLens ln ON ln.id_local = hm.lensRef");
      }
    }
  }

  const filter = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
  // GROUP BY collapses anything the joins fan out, so one file is one row.
  return `SELECT ${select.join(", ")} FROM AgLibraryFile fi ${joins.join(" ")}${filter} GROUP BY fi.id_local`;
}

/** Joins root + relative folder + basename, tolerating stray slashes. */
function buildPath(root: string, sub: string, name: string): string {
  const trimmedRoot = root.replace(/[\\/]+$/, "");
  const trimmedSub = sub.replace(/^[\\/]+|[\\/]+$/g, "");
  const dir = trimmedSub === "" ? trimmedRoot : `${trimmedRoot}/${trimmedSub}`;
  return `${dir}/${name}`;
}

function numberOrNull(value: unknown, min = -Infinity, max = Infinity): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

export async function indexLightroomSource(
  db: Db,
  source: SourceConfig,
  options: IndexOptions = {},
): Promise<IndexStats> {
  const started = performance.now();
  const stats = emptyStats();

  const catalogPath = normPath(source.path);
  const row = db.upsertSource(source.key, source.label, "lightroom", catalogPath);
  const run = row.run + 1;

  options.onProgress?.({ phase: "starting", directories: 0, files: 0, done: 0, total: 0 });

  const copy = await copyCatalog(catalogPath);
  let cat: DatabaseSync;
  try {
    cat = openCatalog(copy.file);
  } catch (err) {
    await copy.cleanup();
    throw new Error(`Could not open Lightroom catalog ${catalogPath}: ${(err as Error).message}`);
  }

  if (!tableExists(cat, "AgLibraryFile")) {
    cat.close();
    await copy.cleanup();
    throw new Error(
      `${path.basename(catalogPath)} does not look like a Lightroom Classic catalog (no AgLibraryFile table).`,
    );
  }

  const upsertDir = db.prep(`
    INSERT INTO directory (source_id, path, path_key, mtime_ms, entry_count, seen_run)
    VALUES (?, ?, ?, 0, 0, ?)
    ON CONFLICT(source_id, path_key) DO UPDATE SET path = excluded.path, seen_run = excluded.seen_run
    RETURNING id
  `);

  // Every column comes from the catalog, so unlike a folder source there is no
  // second pass: the row is written complete the first time.
  const upsertPhoto = db.prep(`
    INSERT INTO photo (
      source_id, dir_id, name, name_key, stem, ext, kind, size, mtime_ms, present, seen_run, created_run,
      meta_state, captured_at, epoch_sec, day, year, ym, weekday, hour, sub_sec,
      camera_id, lens_id, body_serial,
      focal, focal35, aperture, shutter, iso, flash, width, height, orientation,
      lat, lon, duration, rating, pick, color_label, shot_key
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, -1, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dir_id, name_key) DO UPDATE SET
      name = excluded.name, seen_run = excluded.seen_run, meta_state = excluded.meta_state,
      captured_at = excluded.captured_at, epoch_sec = excluded.epoch_sec, day = excluded.day, year = excluded.year, ym = excluded.ym,
      weekday = excluded.weekday, hour = excluded.hour, sub_sec = excluded.sub_sec,
      camera_id = excluded.camera_id, lens_id = excluded.lens_id, body_serial = excluded.body_serial,
      focal = excluded.focal, focal35 = excluded.focal35, aperture = excluded.aperture,
      shutter = excluded.shutter, iso = excluded.iso, flash = excluded.flash,
      width = excluded.width, height = excluded.height, orientation = excluded.orientation,
      lat = excluded.lat, lon = excluded.lon, duration = excluded.duration,
      rating = excluded.rating, pick = excluded.pick, color_label = excluded.color_label,
      shot_key = excluded.shot_key
    RETURNING created_run
  `);

  const dirIds = new Map<string, number>();
  let pending: CatalogRow[] = [];

  const flush = () => {
    if (pending.length === 0) return;
    const work = pending;
    pending = [];

    db.tx(() => {
      for (const r of work) {
        if (!r.rootPath || !r.baseName) continue;

        const ext = (r.extension ?? "").toLowerCase();
        const name = ext === "" ? r.baseName : `${r.baseName}.${ext}`;
        const fullPath = buildPath(r.rootPath, r.subPath ?? "", name);
        const dirPath = fullPath.slice(0, fullPath.lastIndexOf("/"));
        const dirKey = pathKey(dirPath);

        // A catalog holds sidecars and the odd PSD; only photographs count.
        const kind =
          (r.fileFormat ?? "").toUpperCase() === "VIDEO" ? "video" : classify(name, extOf(name));
        if (kind === null) continue;

        let dirId = dirIds.get(dirKey);
        if (dirId === undefined) {
          dirId = (upsertDir.get(row.id, dirPath, dirKey, run) as { id: number }).id;
          dirIds.set(dirKey, dirId);
        }

        const capturedAt = parseExifDate(r.captureTime ?? null);
        // The catalog stores only the model — see normalizeCamera on why the
        // key is built to match a folder source's anyway.
        const camera = normalizeCamera(null, r.cameraModel ?? null);
        const lens = normalizeLens(null, r.lensModel ?? null);
        const cameraId = camera ? db.internCamera(camera) : null;
        const lensId = lens ? db.internLens(lens) : null;

        const width = numberOrNull(r.fileWidth, 1, 1e6);
        const height = numberOrNull(r.fileHeight, 1, 1e6);
        const latitude = numberOrNull(r.gpsLatitude, -90, 90);
        const longitude = numberOrNull(r.gpsLongitude, -180, 180);
        const hasFix = latitude !== null && longitude !== null && !(latitude === 0 && longitude === 0);

        const result = upsertPhoto.get(
          row.id,
          dirId,
          name,
          name.toLowerCase(),
          stemOf(name),
          extOf(name),
          kind,
          run,
          run,
          capturedAt !== null || cameraId !== null || lensId !== null ? "ok" : "none",
          capturedAt,
          capturedAt === null ? null : epochSecondsOf(capturedAt),
          capturedAt === null ? null : dayOf(capturedAt),
          capturedAt === null ? null : yearOf(capturedAt),
          capturedAt === null ? null : yearMonthOf(capturedAt),
          capturedAt === null ? null : weekdayOf(dayOf(capturedAt)),
          capturedAt === null ? null : hourOf(capturedAt),
          null, // The catalog rounds capture time to the second.
          cameraId,
          lensId,
          cleanField(r.cameraSerial ?? "") || null,
          numberOrNull(r.focalLength, 0.5, 5000),
          null, // No 35mm equivalent is harvested, so the barrel figure stands alone.
          apexToAperture(numberOrNull(r.aperture, 0, 20) ?? NaN),
          apexToShutter(numberOrNull(r.shutterSpeed, -12, 20) ?? NaN),
          numberOrNull(r.isoSpeedRating, 1, 4194304),
          r.flashFired === null || r.flashFired === undefined ? null : r.flashFired ? 1 : 0,
          width,
          height,
          ORIENTATION_CODES[cleanField(r.orientation ?? "").toUpperCase()] ?? null,
          hasFix ? latitude : null,
          hasFix ? longitude : null,
          null, // Clip length is not harvested into the catalog.
          numberOrNull(r.rating, 0, 5),
          numberOrNull(r.pick, -1, 1),
          cleanField(r.colorLabels ?? "") || null,
          shotKeyFor(cameraId, capturedAt, stemOf(name), `${dirKey}/${name.toLowerCase()}`),
        ) as { created_run: number } | undefined;

        if (result && result.created_run === run) stats.added++;
        stats.files++;
      }
    });
  };

  try {
    const query = buildQuery(cat);
    for (const raw of cat.prepare(query).iterate() as Iterable<CatalogRow>) {
      if (options.signal?.aborted) throw new DOMException("Index aborted", "AbortError");

      pending.push(raw);
      if (pending.length >= BATCH_ROWS) {
        flush();
        options.onProgress?.({
          phase: "reading-catalog",
          directories: dirIds.size,
          files: stats.files,
          done: stats.files,
          total: 0,
          message: "Reading the catalog",
        });
      }
    }
    flush();
  } finally {
    cat.close();
    await copy.cleanup();
  }

  options.onProgress?.({
    phase: "sweeping",
    directories: dirIds.size,
    files: stats.files,
    done: 0,
    total: 0,
  });

  db.tx(() => {
    const removed = db.prep("DELETE FROM photo WHERE source_id = ? AND seen_run < ?").run(row.id, run);
    stats.removed = Number(removed.changes);
    db.prep("DELETE FROM directory WHERE source_id = ? AND seen_run < ?").run(row.id, run);
  });

  stats.directories = dirIds.size;
  stats.files = db.countPhotos(row.id);
  stats.withMetadata =
    db.getAs<{ n: number }>(
      "SELECT COUNT(*) AS n FROM photo WHERE source_id = ? AND meta_state = 'ok'",
      row.id,
    )?.n ?? 0;
  stats.durationMs = Math.round(performance.now() - started);

  db.prep("UPDATE source SET run = ?, last_indexed_at = ?, stats = ? WHERE id = ?").run(
    run,
    Date.now(),
    JSON.stringify(stats),
    row.id,
  );

  options.onProgress?.({
    phase: "done",
    directories: stats.directories,
    files: stats.files,
    done: 0,
    total: 0,
  });

  return stats;
}
