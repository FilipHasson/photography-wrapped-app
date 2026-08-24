import fs from "node:fs/promises";
import path from "node:path";
import { configDir, configFile, normPath } from "./paths.ts";
import { isValidDay } from "./time.ts";
import { DEFAULT_NAMING, VERBATIM_NAMING, type NamingOptions } from "./gear.ts";
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
  /** On `bought` and `sold`; absent on the rest. */
  gear?: AnchorGear;
  /**
   * The last day of a trip, inclusive. Only ever on `trip`.
   *
   * A photoshoot is a day and a gear milestone is a moment, so neither has one.
   * Absent rather than equal to `day` for those, because "this thing has an end
   * date" and "this thing ended the day it started" are different claims, and
   * the second one would put a one-day band on every chart in the deck.
   */
  until?: number;
}

/**
 * What a milestone is about.
 *
 * `bought` and `sold` point at gear. `trip` covers a span of days and `shoot`
 * a single one — both of them count the frames inside their own window, which
 * is what keeps them facts rather than captions: a fortnight in Iceland that
 * says how many photographs came out of it is worth a mark on a chart, and a
 * date with a phrase on it is worth rather less.
 */
export type AnchorKind = "bought" | "sold" | "custom" | "trip" | "shoot";

/** The kinds that carry a window, and so a count of frames inside it. */
export const WINDOWED_KINDS: readonly AnchorKind[] = ["trip", "shoot"];

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
  /**
   * Photographs thrown away before this tool ever saw the library.
   *
   * Nothing in a catalog records what used to be in it, so every frame deleted
   * before the first sweep is invisible here — and for most photographers that
   * is the larger half of the culling. This is the reader's own answer to
   * "roughly how many?", and all it claims is that those frames were shot and
   * then thrown out.
   *
   * It carries no date, so it does not narrow with the range: a deck of 2025
   * carries the same figure an all-time deck does. That is the reader's call —
   * they are the only person who knows what those frames were, and a number
   * that vanished whenever you looked at a single year is a setting nobody can
   * find the effect of. `computeStats` reads it in exactly one place, and the
   * table on both slides that use it says which rows it is in.
   */
  deletedBefore: number;
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
  /**
   * Colours the reader has chosen, and only those.
   *
   * Deliberately sparse. Storing the whole palette would freeze today's
   * defaults into every config, and somebody who never opened the panel would
   * stop getting improvements to it — so a role that is not in here is drawn
   * from the built-in palette, for ever.
   *
   * Light and dark are separate because they are not inversions of each other:
   * a colour picked against a near-white surface is not the colour to draw on a
   * near-black one, which is why the built-in palette has two columns rather
   * than one and a filter.
   */
  palette: Palette;
  /**
   * What a slide is drawn *on*, before anything is drawn.
   *
   * Flat is the default and always will be: these are data slides, and a
   * backdrop is decoration that has to earn its place by staying out of the
   * way. The seed is what makes "randomly generated" repeatable — the same deck
   * has to come back the same on screen, on the contact sheet and in the
   * exported PNG, or the shapes are a different picture every time anyone
   * looks. Shuffling is therefore picking a new number here, never calling
   * `Math.random` while drawing.
   */
  backdrop: Backdrop;
  /**
   * Which of the five ways a card is drawn. Glass by default — it is the one
   * that keeps a generated backdrop visible under the panels, which is what
   * made the flat one look like a hole punched through the slide.
   */
  cardStyle: CardStyle;
  /** Port for the local UI. 0 picks a free one. */
  port: number;
}

/** One entry per role the reader has changed. See `PALETTE_ROLES`. */
export type PaletteOverride = Record<string, string>;

export interface Palette {
  light: PaletteOverride;
  dark: PaletteOverride;
}

/**
 * The colours a chart draws with, named by what they do rather than where they
 * live in the theme object.
 *
 * Three of these have a second job, and the name has to say so: a picker
 * labelled "Series 1" that quietly repaints Picked, the working week and every
 * bar in the deck is a picker that lies.
 *
 * The surface and the text on it were held back at first, as the shortest path
 * to a slide nobody can read. They are here now because a deck people post is a
 * deck they want to look like theirs, and the readability is defended where it
 * belongs instead: `paletteProblems` measures every text role against whatever
 * background it has been given, and says so loudly. Warned, never blocked.
 */
/**
 * Two groups, and the split is what a role belongs to rather than where it is
 * drawn. `page` roles are the same on every slide — the paper and the writing on
 * it — so they belong with the deck. `data` roles are what a particular chart
 * encodes with, and which of them matter changes as the reader moves through
 * the deck. Mixing them put "Heat 3" between the background and the headline in
 * one long list, which is how the panel came to be unusable on the slides with
 * the most colours in them.
 */
export type PaletteGroup = "page" | "data";

export const PALETTE_ROLES: ReadonlyArray<{ id: string; label: string; note?: string; group: PaletteGroup }> = [
  { group: "page", id: "surface", label: "The background", note: "the slide itself, and what everything is read against" },
  { group: "page", id: "ink", label: "Headlines", note: "the big number and the line under it" },
  { group: "page", id: "ink2", label: "Body text", note: "labels beside a bar, names on a legend" },
  { group: "page", id: "muted", label: "The quiet text", note: "axis numbers and the footnote" },
  { group: "page", id: "plane", label: "Cards", note: "the blocks on keepers and culling" },
  { group: "page", id: "track", label: "The rest of a bar", note: "behind the part that is filled" },
  { group: "data", id: "series.0", label: "The main colour", note: "every single-series chart, Picked, the working week" },
  { group: "data", id: "series.1", label: "The weekend", note: "and the second lens on gear over time" },
  { group: "data", id: "series.2", label: "Series 3" },
  { group: "data", id: "series.3", label: "Series 4" },
  { group: "data", id: "series.4", label: "Series 5" },
  { group: "data", id: "series.5", label: "Series 6" },
  { group: "data", id: "series.6", label: "Series 7" },
  { group: "data", id: "series.7", label: "The negative", note: "the longest quiet spell, Rejected" },
  // Numbered, because three wells all labelled "Heat" is three wells nobody
  // can tell apart — which is the exact complaint this panel exists to fix.
  { group: "data", id: "ramp.0", label: "Heat 1", note: "a day with barely anything on it" },
  { group: "data", id: "ramp.1", label: "Heat 2" },
  { group: "data", id: "ramp.2", label: "Heat 3" },
  { group: "data", id: "ramp.3", label: "Heat 4" },
  { group: "data", id: "ramp.4", label: "Heat 5", note: "your busiest days" },
  { group: "data", id: "rampEmpty", label: "A day off the calendar", note: "in the range, no photographs" },
  { group: "data", id: "blank", label: "Nothing happened", note: "a day on the wall you did not shoot" },
  { group: "data", id: "night", label: "The small hours", note: "one pole of the clock" },
  { group: "data", id: "day", label: "The middle of the day", note: "the other pole" },
  { group: "page", id: "grid", label: "Hairlines" },
  { group: "page", id: "axis", label: "Axes", note: "and the pooled \"Everything else\"" },
];

const ROLE_IDS = new Set(PALETTE_ROLES.map((role) => role.id));
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Whatever of a saved palette is still meaningful.
 *
 * A role this version does not have is dropped rather than kept: it would be
 * dead weight in every config from here on, and nothing would ever draw it.
 */
export function coercePaletteSide(value: unknown): PaletteOverride {
  if (typeof value !== "object" || value === null) return {};
  const out: PaletteOverride = {};

  for (const [id, hex] of Object.entries(value as Record<string, unknown>)) {
    if (ROLE_IDS.has(id) && typeof hex === "string" && HEX.test(hex)) out[id] = hex.toLowerCase();
  }
  return out;
}

/**
 * The four grounds a slide can be drawn on.
 *
 * `blobs` is soft fields of colour riding the edges of the frame, `rings` is
 * arcs swung from a corner — the one shape a camera suggests — and `grain` is a
 * thin scatter of dots. All three are drawn from the reader's own palette, and
 * all three keep out of the middle of the frame, where the words are.
 */
export type BackdropKind = "flat" | "blobs" | "rings" | "grain";

export const BACKDROP_KINDS: readonly BackdropKind[] = ["flat", "blobs", "rings", "grain"];

export interface Backdrop {
  kind: BackdropKind;
  /** Which arrangement of it. The page shuffles by picking a different number. */
  seed: number;
}

/**
 * How the panels on a slide are drawn — culling, keepers, the figures beside
 * each year, the ground under the map.
 *
 * Ids only. What each one *looks* like lives in `web/cards.js`, along with the
 * words the chips use, because that is the layer that draws: nothing under
 * `web/` may be imported from here, and a second copy of the labels would drift
 * from the first within a month. This list exists so a hand-edited config
 * cannot put an unknown style into the deck.
 */
export type CardStyle = "glass" | "soft" | "outline" | "tinted" | "flat";

export const CARD_STYLES: readonly CardStyle[] = ["glass", "soft", "outline", "tinted", "flat"];

export function coerceCardStyle(value: unknown): CardStyle {
  return CARD_STYLES.find((entry) => entry === value) ?? "glass";
}

export function coerceBackdrop(value: unknown): Backdrop {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const kind = BACKDROP_KINDS.find((entry) => entry === raw.kind) ?? "flat";
  const seed = Number(raw.seed);
  return { kind, seed: Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) % 100000 : 1 };
}

/**
 * A count somebody typed, in whatever way people type counts.
 *
 * The separators go first. "10,218" and "10 218" are the same answer as 10218,
 * and `Number` reads all three as `NaN` — which would land here as nought and
 * look exactly like the setting refusing to save. That is not hypothetical:
 * this field started as an `<input type="number">`, which reports an empty
 * string for anything it dislikes and throws the typing away without a word.
 *
 * Then floored at zero and rounded down, because a negative photograph is not
 * one and neither is two thirds of one. The ceiling exists only so a slipped
 * keypress cannot put a nine-digit number on the opening slide.
 */
export function coerceCount(value: unknown): number {
  const n = typeof value === "string" ? Number(value.replace(/[\s,_']/g, "")) : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.trunc(n), 100_000_000) : 0;
}

export function coercePalette(value: unknown): Palette {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return { light: coercePaletteSide(raw.light), dark: coercePaletteSide(raw.dark) };
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
    deletedBefore: 0,
    ownerName: "",
    location: { ...DEFAULT_CITY },
    palette: { light: {}, dark: {} },
    backdrop: { kind: "flat", seed: 1 },
    cardStyle: "glass",
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

/**
 * Naming preferences, including from a config written before there were six.
 *
 * `lensStyle` was one switch with two opinions inside it — "short" dropped the
 * aperture and the engineering words together, "full" kept both. Reading it back
 * as the flags it stood for is what keeps an existing deck reading exactly as it
 * did the day before this shipped.
 */
export function coerceNaming(value: unknown): NamingOptions {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;

  if (typeof raw.lensStyle === "string" && !("showMount" in raw)) {
    const base = raw.lensStyle === "full" ? VERBATIM_NAMING : DEFAULT_NAMING;
    return { ...base, showMake: raw.showMake !== false };
  }

  const naming = { ...DEFAULT_NAMING };
  for (const key of Object.keys(naming) as Array<keyof NamingOptions>) {
    if (typeof raw[key] === "boolean") naming[key] = raw[key] as boolean;
  }
  return naming;
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
    naming: coerceNaming(r.naming),
    mergeRawJpegPairs: r.mergeRawJpegPairs !== false,
    includeVideo: r.includeVideo !== false,
    deletedBefore: coerceCount(r.deletedBefore),
    ownerName: typeof r.ownerName === "string" ? r.ownerName.trim().slice(0, 60) : "",
    // A config from before locations existed has no key at all; that is not the
    // same as `null`, which is somebody having pressed Clear.
    location: "location" in r ? coercePlace(r.location) : { ...DEFAULT_CITY },
    palette: coercePalette(r.palette),
    backdrop: coerceBackdrop(r.backdrop),
    cardStyle: coerceCardStyle(r.cardStyle),
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
  about: { kind?: AnchorKind; gear?: AnchorGear | null; until?: number | null } = {},
): Anchor {
  const trimmed = label.trim().slice(0, 60);
  const anchor: Anchor = { id: makeKey(trimmed, taken), label: trimmed, day, kind: "custom" };
  const kind = about.kind ?? "custom";

  // A trip is a span, and a span that ends before it starts is not one. An end
  // date that fails is dropped rather than rejected: what is left is still a
  // perfectly good dated milestone, and losing the whole thing over one field
  // is how a reader's own note disappears.
  if (kind === "trip") {
    const until = about.until;
    const ranged = typeof until === "number" && isValidDay(until) && until >= day;
    return ranged ? { ...anchor, kind, until } : { ...anchor, kind: "shoot" };
  }
  if (kind === "shoot") return { ...anchor, kind };

  // A category with nothing behind it is not a category. `bought` without gear
  // would claim a milestone knows which camera it means, and then no slide
  // could ever find one.
  return kind !== "custom" && about.gear ? { ...anchor, kind, gear: about.gear } : anchor;
}

export const ANCHOR_KINDS: readonly AnchorKind[] = ["bought", "sold", "custom", "trip", "shoot"];
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
  const until = Number(raw.until);

  return {
    ...makeAnchor(label, day, [], { kind, gear, until: Number.isFinite(until) ? until : null }),
    id,
  };
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
  // A trip and a shoot have no gear to name themselves after, so there is
  // nothing to draft: the reader is typing where they went or what they shot.
  if (kind === "trip" || kind === "shoot") return "";
  return gearLabel;
}
