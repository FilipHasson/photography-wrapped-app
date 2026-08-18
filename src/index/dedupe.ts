import type { Db } from "../core/db.ts";

/**
 * Deciding which rows are photographs and which are copies of one.
 *
 * Counting files would be wrong in three ordinary situations, and every one of
 * them is common enough to ruin a deck:
 *
 *  1. **RAW + JPEG.** Shooting both writes two files per press of the shutter.
 *     That is a storage decision, not two photographs.
 *  2. **The same folder indexed twice** — a Pictures folder and the Lightroom
 *     catalog that points at it. Every frame would count twice.
 *  3. **A backup drive added as a second source.** Same again, at a different
 *     path.
 *
 * So exactly one row per photograph is marked `is_primary`, and every slide
 * counts primaries. Two passes do it, in this order:
 *
 *  - **By path.** One row per file on disk, which settles (2) exactly: two
 *    sources describing the same path collapse, and nothing else does.
 *  - **By frame.** One row per `shot_key` — a body plus a wall-clock instant —
 *    which settles (1) and (3).
 *
 * The passes are separate because they answer different questions with
 * different certainty. Path identity is exact; frame identity is inferred from
 * what the camera recorded (see `shotKeyFor`). Settling the exact one first
 * means the inferred one only ever runs on rows that really are distinct files.
 */

export interface DedupeOptions {
  /** When false, a raw file and its JPEG are counted as two photographs. */
  mergeRawJpegPairs: boolean;
}

export interface DedupeResult {
  /** Photographs — rows left marked primary. */
  shots: number;
  /** Rows that turned out to be another view of a photograph already counted. */
  duplicates: number;
}

/**
 * Preference between rows describing the same photograph, best first:
 * one that carries a rating (only a catalog has those), then one that knows
 * its lens, then the catalog row over the folder row, then oldest id so the
 * choice is stable between runs.
 */
const PATH_PREFERENCE = "(p.rating IS NULL), (p.lens_id IS NULL), (s.kind <> 'lightroom'), p.id";

/**
 * Within one frame the raw file wins: it is the negative, the JPEG is a print
 * of it. Then whichever row knows more.
 */
const FRAME_PREFERENCE = "(kind <> 'raw'), (rating IS NULL), (lens_id IS NULL), size DESC, id";

export function rebuildPrimaries(db: Db, options: DedupeOptions): DedupeResult {
  return db.tx(() => {
    // Fields filled in from a sibling row below are reset to what the source
    // itself said first, so this whole pass stays a pure function of the index
    // however many times it runs.
    db.prep(
      "UPDATE photo SET rating = NULL, pick = NULL WHERE source_id IN (SELECT id FROM source WHERE kind <> 'lightroom')",
    ).run();
    db.prep(
      "UPDATE photo SET size = -1 WHERE source_id IN (SELECT id FROM source WHERE kind = 'lightroom')",
    ).run();

    db.prep("UPDATE photo SET is_primary = 0").run();

    db.prep(`
      UPDATE photo SET is_primary = 1 WHERE id IN (
        SELECT id FROM (
          SELECT p.id AS id, ROW_NUMBER() OVER (
            PARTITION BY d.path_key || '/' || p.name_key
            ORDER BY ${PATH_PREFERENCE}
          ) AS rn
          FROM photo p
          JOIN directory d ON d.id = p.dir_id
          JOIN source s ON s.id = p.source_id
          WHERE p.present = 1
        ) WHERE rn = 1
      )
    `).run();

    if (options.mergeRawJpegPairs) {
      // Only capture-time keys describe a frame; a `p:` key is the file's own
      // path, which the pass above has already settled.
      db.prep(`
        UPDATE photo SET is_primary = 0 WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
              PARTITION BY shot_key ORDER BY ${FRAME_PREFERENCE}
            ) AS rn
            FROM photo
            WHERE present = 1 AND is_primary = 1 AND shot_key LIKE 'c:%'
          ) WHERE rn > 1
        )
      `).run();
    }

    // A catalog row knows the rating but not the file size; a folder row knows
    // the size but never the rating. Whichever won, it inherits what the other
    // knew about the same photograph.
    db.prep(`
      UPDATE photo SET size = (
        SELECT MAX(q.size) FROM photo q WHERE q.shot_key = photo.shot_key AND q.present = 1
      )
      WHERE is_primary = 1 AND present = 1 AND size < 0 AND shot_key IS NOT NULL
        AND EXISTS (SELECT 1 FROM photo q WHERE q.shot_key = photo.shot_key AND q.size > 0)
    `).run();

    for (const column of ["rating", "pick"]) {
      db.prep(`
        UPDATE photo SET ${column} = (
          SELECT MAX(q.${column}) FROM photo q WHERE q.shot_key = photo.shot_key AND q.${column} IS NOT NULL
        )
        WHERE is_primary = 1 AND present = 1 AND ${column} IS NULL AND shot_key IS NOT NULL
          AND EXISTS (SELECT 1 FROM photo q WHERE q.shot_key = photo.shot_key AND q.${column} IS NOT NULL)
      `).run();
    }

    const shots =
      db.getAs<{ n: number }>("SELECT COUNT(*) AS n FROM photo WHERE is_primary = 1 AND present = 1")?.n ?? 0;
    const total =
      db.getAs<{ n: number }>("SELECT COUNT(*) AS n FROM photo WHERE present = 1")?.n ?? 0;

    return { shots, duplicates: total - shots };
  });
}
