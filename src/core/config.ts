import fs from "node:fs/promises";
import path from "node:path";
import { configDir, configFile, normPath } from "./paths.ts";
import { isValidDay } from "./time.ts";

export type SourceKind = "folder" | "lightroom";

export interface SourceConfig {
  key: string;
  label: string;
  kind: SourceKind;
  /** Folder root, or the path to a `.lrcat` file. */
  path: string;
  enabled: boolean;
  /** Directory names, matched case-insensitively, skipped during the walk. */
  excludes: string[];
}

/**
 * A day worth measuring from — the day a camera arrived, a move, a trip.
 *
 * Saved rather than typed in each time, because these are the dates a
 * photographer thinks in: "since I got the a9 III" is a more meaningful deck
 * than "2024", and it should be one click every time.
 */
export interface Anchor {
  id: string;
  label: string;
  /** `YYYYMMDD`. */
  day: number;
}

/** Gear whose frames are left out of every count. */
export interface Exclusions {
  cameras: string[];
  lenses: string[];
}

export interface AppConfig {
  version: number;
  sources: SourceConfig[];
  anchors: Anchor[];
  /**
   * Ignore everything before this day, in every range including all-time.
   *
   * A catalog reaches back further than the photography usually does: phone
   * snaps, scans, a partner's import. One such year in an all-time deck moves
   * every average and every "favourite", so the floor is a first-class setting
   * rather than something to be worked around with custom ranges.
   */
  startDay: number | null;
  /**
   * Keys from the `camera` and `lens` tables. A single iPhone frame in a
   * catalog is a camera in the data and noise on a slide; hiding it here takes
   * its frames out of every count, not just off one chart.
   */
  excluded: Exclusions;
  /**
   * Count a raw file and its out-of-camera JPEG as one photograph. On by
   * default: shooting RAW+JPEG is a storage decision, not two photographs, and
   * leaving it off doubles every number for the people who do it.
   */
  mergeRawJpegPairs: boolean;
  /** Include video clips in the counts, or leave the deck to stills only. */
  includeVideo: boolean;
  /** Optional, and only ever used to title the deck ("Filip's 2025"). */
  ownerName: string;
  /** Port for the local UI. 0 picks a free one. */
  port: number;
}

export const CONFIG_VERSION = 1;

export function defaultConfig(): AppConfig {
  return {
    version: CONFIG_VERSION,
    sources: [],
    anchors: [],
    startDay: null,
    excluded: { cameras: [], lenses: [] },
    mergeRawJpegPairs: true,
    includeVideo: true,
    ownerName: "",
    port: 4112,
  };
}

/** Slugify a label into a short stable key. */
export function makeKey(label: string, taken: readonly string[] = []): string {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base === "" || /^[0-9-]/.test(base)) base = `src-${base}`.replace(/-+$/, "");

  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function defaultSource(partial: Partial<SourceConfig> & { path: string }): SourceConfig {
  const kind: SourceKind =
    partial.kind ?? (partial.path.toLowerCase().endsWith(".lrcat") ? "lightroom" : "folder");
  const label = partial.label ?? path.basename(partial.path).replace(/\.lrcat$/i, "");
  return {
    key: partial.key ?? makeKey(label),
    label,
    kind,
    path: normPath(partial.path),
    enabled: partial.enabled ?? true,
    excludes: partial.excludes ?? [],
  };
}

export interface ConfigProblem {
  field: string;
  message: string;
}

export function validateConfig(cfg: AppConfig): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const seen = new Set<string>();

  for (const source of cfg.sources) {
    if (seen.has(source.key)) {
      problems.push({ field: `sources.${source.key}`, message: `Duplicate source key "${source.key}".` });
    }
    seen.add(source.key);

    if (!source.path) {
      problems.push({ field: `sources.${source.key}`, message: `Source "${source.label}" has no path.` });
    }
  }

  return problems;
}

/** Fill in anything missing so an older or hand-edited file still loads. */
function coerce(raw: unknown): AppConfig {
  const base = defaultConfig();
  if (typeof raw !== "object" || raw === null) return base;
  const r = raw as Record<string, unknown>;

  const sources = Array.isArray(r.sources)
    ? r.sources
        .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
        .filter((s) => typeof s.path === "string" && s.path !== "")
        .map((s) => defaultSource(s as Partial<SourceConfig> & { path: string }))
    : [];

  const anchors = Array.isArray(r.anchors)
    ? r.anchors
        .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
        .map((a) => ({
          id: typeof a.id === "string" && a.id !== "" ? a.id : makeKey(String(a.label ?? "anchor")),
          label: String(a.label ?? "").trim().slice(0, 60),
          day: Number(a.day),
        }))
        .filter((a) => a.label !== "" && isValidDay(a.day))
        .sort((a, b) => a.day - b.day)
    : [];

  const excluded = (r.excluded ?? {}) as Record<string, unknown>;
  const keyList = (value: unknown) =>
    Array.isArray(value) ? value.filter((k): k is string => typeof k === "string" && k !== "") : [];

  return {
    version: typeof r.version === "number" ? r.version : CONFIG_VERSION,
    sources,
    anchors,
    startDay: isValidDay(Number(r.startDay)) ? Number(r.startDay) : null,
    excluded: { cameras: keyList(excluded.cameras), lenses: keyList(excluded.lenses) },
    mergeRawJpegPairs: r.mergeRawJpegPairs !== false,
    includeVideo: r.includeVideo !== false,
    ownerName: typeof r.ownerName === "string" ? r.ownerName.trim().slice(0, 60) : "",
    port: typeof r.port === "number" && Number.isFinite(r.port) ? r.port : base.port,
  };
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const text = await fs.readFile(configFile(), "utf8");
    return coerce(JSON.parse(text));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return defaultConfig();
    if (err instanceof SyntaxError) {
      throw new Error(`Config at ${configFile()} is not valid JSON: ${err.message}`);
    }
    throw err;
  }
}

export async function saveConfig(cfg: AppConfig): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true });
  const target = configFile();
  const tmp = `${target}.tmp`;
  // Write-then-rename so an interrupted save cannot leave a truncated config.
  await fs.writeFile(tmp, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  await fs.rename(tmp, target);
}

export function findSource(cfg: AppConfig, key: string): SourceConfig | undefined {
  return cfg.sources.find((s) => s.key === key);
}

/** Anchors are addressed by id in a URL, so the id has to survive a rename. */
export function makeAnchor(label: string, day: number, taken: readonly string[]): Anchor {
  return { id: makeKey(label, taken), label: label.trim().slice(0, 60), day };
}
