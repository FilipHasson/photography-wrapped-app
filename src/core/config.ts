import fs from "node:fs/promises";
import path from "node:path";
import { configDir, configFile, normPath } from "./paths.ts";

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

export interface AppConfig {
  version: number;
  sources: SourceConfig[];
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

  return {
    version: typeof r.version === "number" ? r.version : CONFIG_VERSION,
    sources,
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
