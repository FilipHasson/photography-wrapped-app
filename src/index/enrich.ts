import type { Db } from "../core/db.ts";
import type { MetaState, ShotMeta } from "../core/exif.ts";
import { readShotMeta } from "../core/exif.ts";
import { dayOf, epochSecondsOf, hourOf, weekdayOf, yearMonthOf, yearOf } from "../core/time.ts";
import { IO_CONCURRENCY, pool } from "../core/pool.ts";
import type { IndexError } from "./types.ts";

/**
 * Filling in the columns every slide is built from.
 *
 * A folder source has to open each file to learn anything — this is the slow
 * part of indexing, and the only part that touches image data. It is cached
 * against `(size, mtime)`, so it happens once per file and a re-index of an
 * unchanged library reads nothing at all.
 */

/** Rows fetched, read and written per batch. */
const BATCH = 500;

const UPDATE_SQL = `
UPDATE photo SET
  meta_state = ?, captured_at = ?, epoch_sec = ?, day = ?, year = ?, ym = ?, weekday = ?, hour = ?, sub_sec = ?,
  camera_id = ?, lens_id = ?, body_serial = ?,
  focal = ?, focal35 = ?, aperture = ?, shutter = ?, iso = ?, flash = ?,
  width = ?, height = ?, orientation = ?, lat = ?, lon = ?, duration = ?,
  shot_key = ?
WHERE id = ?`;

/**
 * Identity of a *frame*: body, wall-clock second, and the name the camera gave
 * it. That is what makes a raw file and its out-of-camera JPEG count once
 * rather than twice — `DSC_2481.NEF` and `DSC_2481.JPG` are one press of the
 * shutter — while two frames of a 20fps burst stay separate, because the
 * camera numbered them differently.
 *
 * Sub-second digits would be the obvious thing to use instead, and they are
 * deliberately not used: EXIF has them, a Lightroom catalog does not. Key on
 * them and the same photograph seen through a folder and through the catalog
 * that indexed it would land in two different buckets, so anyone who added both
 * — the ordinary case — would see every raw + JPEG pair counted twice.
 *
 * With no capture time there is nothing to reason with, so the file's own path
 * is the key. That merges the same file seen by two sources, and nothing else.
 */
export function shotKeyFor(
  cameraId: number | null,
  capturedAt: number | null,
  stem: string,
  fallback: string,
): string {
  if (capturedAt === null || cameraId === null) return `p:${fallback}`;
  return `c:${cameraId}:${capturedAt}:${stem}`;
}

export interface MetaWriter {
  (photoId: number, state: MetaState, meta: ShotMeta, stem: string, fallbackKey: string): void;
}

/** A bound writer, so the statement and the intern caches are prepared once. */
export function metaWriter(db: Db): MetaWriter {
  const stmt = db.prep(UPDATE_SQL);

  return (photoId, state, meta, stem, fallbackKey) => {
    const cameraId = meta.camera ? db.internCamera(meta.camera) : null;
    const lensId = meta.lens ? db.internLens(meta.lens) : null;
    const captured = meta.capturedAt;

    stmt.run(
      state,
      captured,
      captured === null ? null : epochSecondsOf(captured),
      captured === null ? null : dayOf(captured),
      captured === null ? null : yearOf(captured),
      captured === null ? null : yearMonthOf(captured),
      captured === null ? null : weekdayOf(dayOf(captured)),
      captured === null ? null : hourOf(captured),
      meta.subSec,
      cameraId,
      lensId,
      meta.bodySerial,
      meta.focal,
      meta.focal35,
      meta.aperture,
      meta.shutter,
      meta.iso === null ? null : Math.round(meta.iso),
      meta.flash,
      meta.width,
      meta.height,
      meta.orientation,
      meta.latitude,
      meta.longitude,
      meta.duration,
      shotKeyFor(cameraId, captured, stem, fallbackKey),
      photoId,
    );
  };
}

export interface EnrichProgress {
  done: number;
  total: number;
}

export interface EnrichOptions {
  signal?: AbortSignal;
  onProgress?: (progress: EnrichProgress) => void;
}

export interface EnrichResult {
  read: number;
  withMetadata: number;
  errors: IndexError[];
}

interface PendingRow {
  id: number;
  name: string;
  name_key: string;
  stem: string;
  ext: string;
  dir_path: string;
  path_key: string;
}

/**
 * Reads capture metadata for every file in a source still marked `pending`.
 *
 * Errors are recorded, never thrown: one corrupt file out of eighty thousand
 * should cost that file's contribution to the deck, nothing more. Only the
 * first handful of messages are kept — a whole unreadable drive would
 * otherwise put a hundred thousand identical strings in the source's stats.
 */
export async function enrichSource(
  db: Db,
  sourceId: number,
  options: EnrichOptions = {},
): Promise<EnrichResult> {
  const total =
    db.getAs<{ n: number }>(
      "SELECT COUNT(*) AS n FROM photo WHERE source_id = ? AND meta_state = 'pending' AND present = 1",
      sourceId,
    )?.n ?? 0;

  const result: EnrichResult = { read: 0, withMetadata: 0, errors: [] };
  if (total === 0) return result;

  const write = metaWriter(db);
  options.onProgress?.({ done: 0, total });

  for (;;) {
    if (options.signal?.aborted) throw new DOMException("Index aborted", "AbortError");

    const rows = db.allAs<PendingRow>(
      `SELECT p.id, p.name, p.name_key, p.stem, p.ext, d.path AS dir_path, d.path_key
       FROM photo p JOIN directory d ON d.id = p.dir_id
       WHERE p.source_id = ? AND p.meta_state = 'pending' AND p.present = 1
       LIMIT ${BATCH}`,
      sourceId,
    );
    if (rows.length === 0) break;

    const read = await pool(rows, IO_CONCURRENCY, async (row) => ({
      row,
      result: await readShotMeta(`${row.dir_path}/${row.name}`, row.ext),
    }));

    db.tx(() => {
      for (const { row, result: meta } of read) {
        write(row.id, meta.state, meta.meta, row.stem, `${row.path_key}/${row.name_key}`);
        result.read++;
        if (meta.state === "ok") result.withMetadata++;
        if (meta.state === "error" && result.errors.length < 20) {
          result.errors.push({ path: `${row.dir_path}/${row.name}`, message: "Could not read metadata" });
        }
      }
    });

    options.onProgress?.({ done: result.read, total });
  }

  return result;
}
