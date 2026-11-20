import { gainsSince, INDEX_VERSION, type Db } from "../core/db.ts";
import type { AppConfig, SourceConfig } from "../core/config.ts";
import { indexFolderSource } from "./folder.ts";
import { indexLightroomSource } from "./lightroom.ts";
import { rebuildPrimaries } from "./dedupe.ts";
import type { IndexOptions, IndexStats } from "./types.ts";

/**
 * Indexes one source, then re-decides which rows are photographs.
 *
 * The dedupe pass runs over the whole index rather than the source just
 * indexed, because adding a source changes what the *other* sources' rows mean
 * — the moment a catalog arrives, the folder rows it points at stop being
 * separate photographs.
 */
export async function indexSource(
  db: Db,
  source: SourceConfig,
  config: AppConfig,
  options: IndexOptions = {},
): Promise<IndexStats> {
  const stats =
    source.kind === "lightroom"
      ? await indexLightroomSource(db, source, options)
      : await indexFolderSource(db, source, options);

  options.onProgress?.({
    phase: "sweeping",
    directories: stats.directories,
    files: stats.files,
    done: 0,
    total: 0,
    message: "Matching up duplicates",
  });
  rebuildPrimaries(db, { mergeRawJpegPairs: config.mergeRawJpegPairs });

  options.onProgress?.({
    phase: "done",
    directories: stats.directories,
    files: stats.files,
    done: 0,
    total: 0,
  });

  return stats;
}

export interface SourceSummary {
  key: string;
  label: string;
  kind: string;
  root: string;
  files: number;
  withMetadata: number;
  lastIndexedAt: number | null;
  stats: IndexStats | null;
  /** The index format this source was last built under. */
  indexVersion: number;
  /** What re-indexing it would add. Empty when it is current. */
  gains: string[];
}

export function summarizeSources(db: Db): SourceSummary[] {
  return db.listSources().map((row) => ({
    key: row.key,
    label: row.label,
    kind: row.kind,
    root: row.root,
    files: db.countPhotos(row.id),
    withMetadata:
      db.getAs<{ n: number }>(
        "SELECT COUNT(*) AS n FROM photo WHERE source_id = ? AND meta_state = 'ok'",
        row.id,
      )?.n ?? 0,
    lastIndexedAt: row.last_indexed_at,
    stats: row.stats ? (JSON.parse(row.stats) as IndexStats) : null,
    indexVersion: row.index_version,
    gains: gainsSince(row.index_version),
  }));
}

/** The format the running code writes. Sources below it are worth rebuilding. */
export { INDEX_VERSION };

/** Photographs in the index once duplicates are set aside, with the span. */
export function indexOverview(db: Db): { shots: number; firstDay: number | null; lastDay: number | null } {
  const row = db.getAs<{ n: number; first: number | null; last: number | null }>(
    `SELECT COUNT(*) AS n, MIN(day) AS first, MAX(day) AS last
     FROM photo WHERE is_primary = 1 AND present = 1`,
  );
  return { shots: row?.n ?? 0, firstDay: row?.first ?? null, lastDay: row?.last ?? null };
}
