import fs from "node:fs/promises";
import path from "node:path";
import { configDir, configFile, normPath } from "./paths.ts";
import { isValidDay } from "./time.ts";
import { DEFAULT_NAMING, type NamingOptions } from "./gear.ts";
import { DEFAULT_CITY } from "./cities.ts";

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
 *
 * Most milestones are about a piece of gear, so most of them point at one
 * rather than describing it in prose. The pointer is a **key** — the same key
 * the index groups frames by — so a body written three different ways across
 * three sources is still the one thing you bought once.
 */
export interface Anchor {
  id: string;
  /** What the deck says. Drafted from the gear, then editable. */
  label: string;
  /** `YYYYMMDD`. */
  day: number;
  /** `custom` is a milestone that is nothing but a date and a phrase. */
  kind: AnchorKind;
  /** On `bought` and `sold`; absent on `custom`. */
  gear?: AnchorGear;
}

export type AnchorKind = "bought" | "sold" | "custom";

/**
 * The three things a milestone can be about.
 *
 * A teleconverter is an item of its own rather than part of the lens in front
 * of it: buying a 1.4x is a purchase in its own right, and the index already
 * keeps the two apart — the converter rides beside the lens in `photo.tc`,
 * split off the name by `splitTeleconverter`.
 */
export type GearDimension = "camera" | "lens" | "teleconverter";

export interface AnchorGear {
  dimension: GearDimension;
  /** A `camera.key` or a `lens.key`; for a converter, `photo.tc` verbatim. */
  key: string;
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
   * How gear is written on a slide. A reader preference, not a fact about the
   * data, so it is applied when a deck is built — changing it re-labels a whole
   * library at once and never touches the index.
   */
  naming: NamingOptions;
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
  /**
   * Where the reader is, for anything that needs to know what the sky was
   * doing — currently the daylight shading on the clock slide.
   *
   * Deliberately *not* taken from the photographs. GPS in a frame says where a
   * trip was, and a fortnight in Iceland should not decide what "after dark"
   * means for a year shot at home. The browser can fill this in from the device
   * with one click, or it can be typed.
   *
   * `null` means the reader cleared it and wants no location at all, which is
   * different from never having had one — a config written before this existed
   * gets the default rather than nothing.
   */
  location: Place | null;
  /** Port for the local UI. 0 picks a free one. */
  port: number;
}

/** A saved position. The label is whatever the reader wants to call it. */
export interface Place {
  lat: number;
  lon: number;
  label: string;
}

export const CONFIG_VERSION = 1;

export function defaultConfig(): AppConfig {
  return {
    version: CONFIG_VERSION,
    sources: [],
    anchors: [],
    startDay: null,
    excluded: { cameras: [], lenses: [] },
    naming: { ...DEFAULT_NAMING },
    mergeRawJpegPairs: true,
    includeVideo: true,
    ownerName: "",
    location: { ...DEFAULT_CITY },
    port: 4112,
  };
}

/** A position is only kept when both halves of it are real. */
export function coercePlace(value: unknown): Place | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  return {
    lat,
    lon,
    label: typeof raw.label === "string" ? raw.label.trim().slice(0, 60) : "",
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

  const ids: string[] = [];
  const anchors = Array.isArray(r.anchors)
    ? r.anchors
        .map((a) => {
          const anchor = coerceAnchor(a, ids);
          if (anchor) ids.push(anchor.id);
          return anchor;
        })
        .filter((a): a is Anchor => a !== null)
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
    naming: {
      lensStyle: (r.naming as NamingOptions | undefined)?.lensStyle === "full" ? "full" : "short",
      showMake: (r.naming as NamingOptions | undefined)?.showMake !== false,
    },
    mergeRawJpegPairs: r.mergeRawJpegPairs !== false,
    includeVideo: r.includeVideo !== false,
    ownerName: typeof r.ownerName === "string" ? r.ownerName.trim().slice(0, 60) : "",
    // A config from before locations existed has no key at all; that is not the
    // same as `null`, which is somebody having pressed Clear.
    location: "location" in r ? coercePlace(r.location) : { ...DEFAULT_CITY },
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
export function makeAnchor(
  label: string,
  day: number,
  taken: readonly string[],
  about: { kind?: AnchorKind; gear?: AnchorGear | null } = {},
): Anchor {
  const trimmed = label.trim().slice(0, 60);
  const anchor: Anchor = { id: makeKey(trimmed, taken), label: trimmed, day, kind: "custom" };

  // A category with nothing behind it is not a category. `bought` without gear
  // would claim a milestone knows which camera it means, and then no slide
  // could ever find one.
  const kind = about.kind ?? "custom";
  return kind !== "custom" && about.gear ? { ...anchor, kind, gear: about.gear } : anchor;
}

const ANCHOR_KINDS: readonly AnchorKind[] = ["bought", "sold", "custom"];
const GEAR_DIMENSIONS: readonly GearDimension[] = ["camera", "lens", "teleconverter"];

/**
 * A milestone read back off disk, or off a request.
 *
 * Anything unrecognised degrades to a plain dated label rather than being
 * thrown away: a config written before categories existed is nothing but
 * those, and they are perfectly good milestones.
 */
export function coerceAnchor(value: unknown, taken: readonly string[] = []): Anchor | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const label = String(raw.label ?? "").trim().slice(0, 60);
  const day = Number(raw.day);
  if (label === "" || !isValidDay(day)) return null;

  const id = typeof raw.id === "string" && raw.id !== "" ? raw.id : makeKey(label, taken);
  const kind = ANCHOR_KINDS.find((k) => k === raw.kind) ?? "custom";
  const gear = coerceAnchorGear(raw.gear);

  return { ...makeAnchor(label, day, [], { kind, gear }), id };
}

export function coerceAnchorGear(value: unknown): AnchorGear | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const dimension = GEAR_DIMENSIONS.find((d) => d === raw.dimension);
  const key = typeof raw.key === "string" ? raw.key.trim() : "";
  return dimension && key !== "" ? { dimension, key } : null;
}

/**
 * The milestone as a *range* says it: "Since the a9 III", never "Since Bought
 * the a9 III".
 *
 * Only the verb the draft put there is taken off, and only while it is still
 * there — a label the reader has rewritten is printed exactly as they wrote it,
 * which is the whole point of the field being editable.
 */
export function anchorRangeLabel(anchor: Anchor): string {
  if (anchor.kind === "bought") return anchor.label.replace(/^bought /i, "");
  if (anchor.kind === "sold") return anchor.label.replace(/^sold /i, "selling ");
  return anchor.label;
}

/**
 * The label a categorised milestone starts life with.
 *
 * A first draft rather than a name: it is put in the field the reader is
 * already looking at, and whatever they leave there is what the deck says.
 */
export function draftAnchorLabel(kind: AnchorKind, gearLabel: string): string {
  if (kind === "bought") return `Bought the ${gearLabel}`;
  if (kind === "sold") return `Sold the ${gearLabel}`;
  return gearLabel;
}
