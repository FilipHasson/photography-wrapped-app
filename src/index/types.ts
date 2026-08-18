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
