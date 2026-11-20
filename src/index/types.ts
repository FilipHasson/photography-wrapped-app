import type { Db } from "../core/db.ts";

export interface IndexError {
  path: string;
  message: string;
}

export type IndexPhase =
  | "starting"
  | "walking"
  | "reading-catalog"
  | "reading-metadata"
  | "sweeping"
  | "done";

export interface IndexProgress {
  phase: IndexPhase;
  directories: number;
  files: number;
  /** Populated during the metadata pass, where a percentage is meaningful. */
  done: number;
  total: number;
  message?: string;
}

export interface IndexStats {
  directories: number;
  files: number;
  added: number;
  removed: number;
  skippedDirectories: number;
  /** Files whose capture metadata could be read. */
  withMetadata: number;
  /** Files opened during this run — zero on a no-change re-index. */
  read: number;
  durationMs: number;
  errors: IndexError[];
}

export interface IndexOptions {
  /**
   * `incremental` trusts directory mtimes and skips stat-ing files in folders
   * that have not changed. `full` re-stats everything and re-reads every
   * header — use it after moving files with tools that preserve timestamps.
   */
  mode?: "incremental" | "full";
  signal?: AbortSignal;
  onProgress?: (progress: IndexProgress) => void;
}

export function emptyStats(): IndexStats {
  return {
    directories: 0,
    files: 0,
    added: 0,
    removed: 0,
    skippedDirectories: 0,
    withMetadata: 0,
    read: 0,
    durationMs: 0,
    errors: [],
  };
}

/**
 * Counts what a sweep is about to delete, split by how it was flagged.
 *
 * A photograph deleted from a catalog leaves no trace in it — the row simply is
 * not there next time — so the only chance to notice is here, in the moment
 * before our copy goes too. Counts only: nothing is kept about a photograph the
 * reader has thrown away, and nothing is kept at all when nothing went.
 */
export function recordRemovals(db: Db, sourceId: number, run: number, now = Date.now()): number {
  const tally = db.getAs<{ removed: number; rejected: number; picked: number; unflagged: number }>(
    `SELECT COUNT(*) AS removed,
            SUM(pick = -1) AS rejected,
            SUM(pick = 1) AS picked,
            SUM(pick IS NULL OR pick = 0) AS unflagged
     FROM photo WHERE source_id = ? AND seen_run < ?`,
    sourceId,
    run,
  );

  const removed = Number(tally?.removed ?? 0);
  if (removed > 0) {
    db.prep(
      `INSERT INTO removal (source_id, run, at, removed, rejected, picked, unflagged)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sourceId,
      run,
      now,
      removed,
      Number(tally?.rejected ?? 0),
      Number(tally?.picked ?? 0),
      Number(tally?.unflagged ?? 0),
    );
  }

  return removed;
}
