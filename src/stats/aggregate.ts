import type { Db } from "../core/db.ts";
import type { Range } from "./range.ts";
import {
  apertureBucket,
  focalBucket,
  focalClass,
  formatAperture,
  formatFocal,
  formatIso,
  formatShutter,
  isoBucket,
  shutterBucket,
  type FocalClass,
} from "../core/units.ts";
import { addDays, dayParts, daysBetween, formatDay, makeDay, todayDay } from "../core/time.ts";
import {
  applyNaming,
  describeCamera,
  describeLens,
  DEFAULT_NAMING,
  VERBATIM_NAMING,
  type NamingOptions,
} from "../core/gear.ts";
import { WINDOWED_KINDS } from "../core/config.ts";
import type { Anchor, AnchorKind, GearDimension } from "../core/config.ts";
import { formatHour, sunTimes } from "../core/sun.ts";

/**
 * Every number a deck can show, in one pass over the index.
 *
 * Two rules hold throughout:
 *
 *  - **Count photographs, not files.** Every query filters on `is_primary`,
 *    which `index/dedupe.ts` has already worked out. A raw and its JPEG are one
 *    photograph; a folder and the catalog pointing at it are one library.
 *  - **Never invent a denominator.** Share of shots on a lens is share of the
 *    shots whose lens is *known*, and each distribution reports how many rows
 *    it actually had. Half a library with no lens recorded should read as "we
 *    know about 8,000 of your 16,000 frames", never as "50% unknown lens".
 */

/**
 * How many rows each truncating slide draws before the tail pools into one.
 *
 * A default, not a rule: eight bars is a chart and forty is a wall, but whose
 * library it is decides where between those the line goes — so every slide that
 * pools a tail offers this as a setting beside it.
 */
export interface RowLimits {
  cameras?: number;
  lenses?: number;
  combos?: number;
  /** Series on the gear-over-time chart. Capped by the palette, see below. */
  gear?: number;
}

export const DEFAULT_LIMITS = { cameras: 8, lenses: 8, combos: 8, gear: 5 } as const;

/** Past this a ranked slide is a table pretending to be a chart. */
export const MAX_ROWS = 40;

/**
 * Series on one stacked chart.
 *
 * The validated palette has eight slots; past those, `web/theme.js` generates
 * hues rather than refusing to draw a ninth lens. Colour alone stops separating
 * them somewhere around ten, which is why the stack carries a legend, a hover
 * label and a table — and why this stops at a number a legend can still name.
 */
export const MAX_SERIES = 25;

export function resolveLimits(limits: RowLimits = {}): Required<RowLimits> {
  const clamp = (value: number | undefined, fallback: number, ceiling: number) =>
    value === undefined || !Number.isFinite(value)
      ? fallback
      : Math.max(1, Math.min(Math.floor(value), ceiling));

  return {
    cameras: clamp(limits.cameras, DEFAULT_LIMITS.cameras, MAX_ROWS),
    lenses: clamp(limits.lenses, DEFAULT_LIMITS.lenses, MAX_ROWS),
    combos: clamp(limits.combos, DEFAULT_LIMITS.combos, MAX_ROWS),
    gear: clamp(limits.gear, DEFAULT_LIMITS.gear, MAX_SERIES),
  };
}

/**
 * Which way a chart's bars run.
 *
 * `rows` is a bar per row reading left to right, `columns` is a bar per column
 * standing up from a baseline. Both are the same numbers; which one reads
 * better depends on the labels, the shape of the frame and the reader — a lens
 * name wants a row, a histogram of shutter speeds wants columns, and ninety
 * months want rows on a story and columns on a 16:9.
 *
 * Stored per slide, by slide id, because that is the level at which the answer
 * changes. Absent means the slide's own natural orientation, which is not the
 * same for all of them.
 */
export type Orientation = "rows" | "columns";
export type Layouts = Record<string, Orientation>;

/**
 * Which slides draw the reader’s milestones.
 *
 * One switch per slide rather than one for the deck, because the answer is
 * genuinely different per chart. Month by month is a row per month with a strip
 * down the side doing nothing else, so a mark costs nothing and explains a
 * cliff; the wall of streaks is dense by design and a ring on a day is the
 * first thing to get in the way of what that slide is for. So the months are
 * annotated out of the box and the wall is not.
 */
export interface MarkToggles {
  timeline?: boolean;
  streaks?: boolean;
  months?: boolean;
}

export const DEFAULT_MARKS = { timeline: true, streaks: false, months: true } as const;

/**
 * Which *kinds* of milestone are drawn, wherever they are drawn.
 *
 * Deliberately one set for the whole deck rather than one per slide. The
 * per-slide switch above answers "do I want annotations on this chart"; this
 * one answers "do I care about trips" — a different question, and one whose
 * answer does not change between two charts of the same library. A slide × type
 * matrix would be twelve controls to express what four express.
 *
 * Purchases and sales are one type. They are the same thing seen twice, they
 * are drawn with the same `+`/`−` vocabulary, and nobody wants their camera
 * arriving on a chart that hides it leaving.
 */
export interface TypeToggles {
  gear?: boolean;
  trip?: boolean;
  shoot?: boolean;
  custom?: boolean;
}

export type MarkType = keyof TypeToggles;

export const MARK_TYPES: readonly MarkType[] = ["gear", "trip", "shoot", "custom"];

export function markTypeOf(kind: AnchorKind): MarkType {
  if (kind === "bought" || kind === "sold") return "gear";
  if (kind === "trip") return "trip";
  if (kind === "shoot") return "shoot";
  return "custom";
}

export function resolveTypes(types: TypeToggles = {}): Required<TypeToggles> {
  return {
    gear: types.gear !== false,
    trip: types.trip !== false,
    shoot: types.shoot !== false,
    custom: types.custom !== false,
  };
}

export function resolveMarks(marks: MarkToggles = {}): Required<MarkToggles> {
  return {
    timeline: marks.timeline ?? DEFAULT_MARKS.timeline,
    streaks: marks.streaks ?? DEFAULT_MARKS.streaks,
    months: marks.months ?? DEFAULT_MARKS.months,
  };
}

/**
 * How much the kit history is allowed to repeat itself.
 *
 * Both of these exist because the slide derives rows from the same handful of
 * milestones, and derived rows overlap: the first lens you bought is often the
 * first thing you sold, and the shortest thing you kept is often that same
 * lens again. Folding those together is what most people want and is the
 * default — but somebody who wants a row per fact, in the order the facts
 * happened, is not wrong, and this is how they say so.
 */
export interface KitToggles {
  /** Bought-first and sold-first become one row when they name one object. */
  combine?: boolean;
  /** Whether "shortest you kept anything" is drawn at all. */
  ownership?: boolean;
}

export const DEFAULT_KIT = { combine: true, ownership: true } as const;

export function resolveKit(kit: KitToggles = {}): Required<KitToggles> {
  return {
    combine: kit.combine ?? DEFAULT_KIT.combine,
    ownership: kit.ownership ?? DEFAULT_KIT.ownership,
  };
}

/** Below this the calendar heatmap gives way to a monthly timeline. */
export const HEATMAP_MAX_DAYS = 400;

export interface TeleconverterPart {
  /** null for the bare lens. */
  tc: string | null;
  shots: number;
}

export interface Tally {
  key: string;
  label: string;
  shots: number;
  /**
   * How the count splits by teleconverter, longest bar first.
   *
   * Only lenses have these, and only when a converter was used: a 200-600 and
   * the same lens with a 1.4x on the back are one row, because they are one
   * lens — the split is a shade within the bar rather than a row of its own.
   */
  parts?: TeleconverterPart[];
  /** Fraction of the shots where this dimension was known, 0–1. */
  share: number;
  firstDay: number | null;
  lastDay: number | null;
  /** Hidden from the deck by a setting. Listed, and counted, but not drawn. */
  excluded: boolean;
}

export interface Bucket {
  value: number;
  label: string;
  shots: number;
}

export interface Distribution {
  buckets: Bucket[];
  /** Shots that carried this field at all. */
  known: number;
  /** The bucket with the most shots. */
  favourite: Bucket | null;
  /** Value at the halfway point, by shot count. */
  median: number | null;
}

export interface Totals {
  shots: number;
  files: number;
  stills: number;
  videos: number;
  raws: number;
  jpegs: number;
  bytes: number;
  videoSeconds: number;
  daysShot: number;
  daysInRange: number;
  cameras: number;
  lenses: number;
  bodies: number;
  firstDay: number | null;
  lastDay: number | null;
  withGps: number;
  withFlash: number;
  rated: number;
  keepers: number;
  /** Same count over the equally long window before this one. */
  previousShots: number | null;
}

export interface DayCount {
  day: number;
  shots: number;
}

export interface MonthCount {
  ym: number;
  shots: number;
}

export interface Streak {
  days: number;
  from: number;
  to: number;
}

export interface Series {
  label: string;
  values: number[];
  /**
   * How many of each month were shot through a teleconverter.
   *
   * Carried beside the totals rather than as series of their own: fifteen
   * series on one stacked chart is unreadable, and the question here is which
   * lens was on the camera — the converter is a shade within it.
   */
  converted?: number[];
}

export interface Place {
  lat: number;
  lon: number;
  shots: number;
}

export interface Debut {
  kind: "camera" | "lens";
  /** The grouping key, so a milestone about this gear can be found. */
  key: string;
  label: string;
  day: number;
  shots: number;
}

/**
 * A milestone the reader saved, with its pointer followed.
 *
 * The config stores a key; this is the thing that key names — written the way
 * the reader's naming settings write it, and carrying what this range knows
 * about it. Gear that has since left the index keeps the milestone and loses
 * the gear: the day it happened is still true.
 */
export interface Milestone {
  id: string;
  /** What the reader called it. This is what any label on a chart says. */
  label: string;
  day: number;
  /**
   * The last day it covers. Equal to `day` for everything but a trip, so a
   * renderer can treat every milestone as a span without asking what kind it is.
   */
  until: number;
  kind: AnchorKind;
  /**
   * Frames inside the window, for the kinds that have one.
   *
   * `null` where the question is meaningless: a purchase is a moment, and the
   * photographs taken on the day a lens arrived say nothing about the lens.
   * Gear milestones carry their count on `gear.shots` instead, which is the
   * frames through that lens rather than the frames on that day.
   */
  shots: number | null;
  gear: {
    dimension: GearDimension;
    key: string;
    label: string;
    /** Inside this range. Zero is a real answer; the gear was simply not used. */
    shots: number;
    firstDay: number | null;
    lastDay: number | null;
  } | null;
}

/**
 * One year of a library, counted three ways.
 *
 * A year is not always a calendar year. Someone who bought their camera in
 * August thinks in years that start in August, and the difference is not
 * cosmetic — it decides whether one trip lands in this year or last.
 */
export interface YearBucket {
  label: string;
  from: number;
  to: number;
  shots: number;
  cameras: number;
  lenses: number;
  /** The period has not finished yet. */
  partial: boolean;
  /** Days still to come in it, 0 once it is over. */
  remaining: number;
}

export type YearBasis = "anchor" | "calendar";

/**
 * How the wall of days is laid out.
 *
 * "packed" wraps the whole range into as many rows of weeks as make the squares
 * biggest, which fills the slide; "years" gives each year a row of its own,
 * which lines the years up under each other at the cost of empty space;
 * "months" is a block per month with the days on their real weekdays, which is
 * the shape a calendar on a wall has and the only one where "the second Sunday
 * of every month" is a thing you can see.
 *
 * They are three answers to the same question and none of them is best: packed
 * is the most days per pixel, years compare one year against another, and
 * months are the easiest to find a particular day in.
 */
export type WallLayout = "packed" | "years" | "months";

/**
 * Which day a week starts on.
 *
 * Not a detail: a Sunday-first reader looking at a Monday-first chart reads the
 * weekend as split across the two ends of it, which is the one shape the slide
 * exists to show. Stored Monday-first because that is what SQLite's `%w` maths
 * was normalised to; the rotation happens where the slide is written.
 */
export type WeekStart = "mon" | "sun" | "sat";

/**
 * Which hours the clock slide treats as daylight.
 *
 * "sun" works them out from where the photographs were taken and when; the
 * others are fixed windows for anyone whose library has no GPS in it, or who
 * would rather draw the line themselves.
 */
export type DaylightMode = "sun" | "06-18" | "07-19" | "05-21" | "custom";

export interface Daylight {
  mode: DaylightMode;
  sunrise: number;
  sunset: number;
  /** Where the window came from, for the slide to own up to. */
  source: string;
  /** Whose position was used: the reader's, or the photographs'. */
  from?: "you" | "frames";
}

/** A place the daylight maths can be done for. */
export interface Location {
  lat: number;
  lon: number;
  /** How many photographs put it there, when it came from the photographs. */
  shots?: number;
  /** What to call it on a slide. Empty for a bare pair of coordinates. */
  label?: string;
}

/**
 * What was kept, what was thrown out, and what was never looked at.
 *
 * Flags rather than stars: a pick is "yes", a reject is "no", and everything
 * else is a frame nobody has been back to. Deletions are counted separately and
 * only from the day this tool first swept the library — see `removal` in
 * `core/db.ts` — because a photograph deleted from a catalog leaves nothing
 * behind to count later.
 */
export interface Culling {
  picked: number;
  rejected: number;
  unflagged: number;
  /** Frames that have left the library since it was first indexed. */
  removed: number;
  /** How many of those had been flagged as rejects. */
  removedRejected: number;
  /** When this tool first swept, and could first have noticed. */
  watchingSince: number | null;
}

export interface Burst {
  frames: number;
  seconds: number;
  day: number;
  camera: string | null;
}

export interface DeckStats {
  range: Range;
  totals: Totals;
  /** Full lists, longest first. The slides decide what to draw of them. */
  cameras: Tally[];
  lenses: Tally[];
  combos: Tally[];
  /** Gear left out of every count, so the tables can offer it back. */
  hiddenCameras: Tally[];
  hiddenLenses: Tally[];
  focal: Distribution;
  focalClasses: Array<{ label: FocalClass; shots: number }>;
  aperture: Distribution;
  iso: Distribution;
  shutter: Distribution;
  hours: number[];
  weekdays: number[];
  daily: DayCount[];
  monthly: MonthCount[];
  timeline: { months: number[]; series: Series[] };
  ratings: number[];
  orientation: { landscape: number; portrait: number; square: number };
  busiestDay: DayCount | null;
  longestStreak: Streak | null;
  longestGap: Streak | null;
  places: Place[];
  placesKnown: number;
  debuts: Debut[];
  /** Saved milestones falling inside the range, oldest first. */
  milestones: Milestone[];
  burst: Burst | null;
  /** One entry per year the range covers, on whichever basis was asked for. */
  years: YearBucket[];
  yearBasis: YearBasis;
  /** Picks, rejects, and what has actually left the library. */
  culling: Culling;
  /** The busiest place, for anything that needs to know where this happened. */
  location: Location | null;
  /** Where the reader said they are, if they have. */
  home: Location | null;
  /** The hours "custom" currently means, so the pickers can show them. */
  daylightHours: { sunrise: number; sunset: number };
  /** How the week slide is laid out and coloured. */
  weekStart: WeekStart;
  markWeekend: boolean;
  /** Which time slides are annotated with the reader's milestones. */
  showMarks: Required<MarkToggles>;
  /** Which kinds of milestone are drawn, on every slide that draws any. */
  showTypes: Required<TypeToggles>;
  /** How much the kit history repeats itself. */
  kit: Required<KitToggles>;
  /**
   * Which way each chart's bars run, where the reader has said. A slide not in
   * here draws itself the way it always has.
   */
  layout: Layouts;
  /** How the wall of days is laid out. */
  wall: WallLayout;
  /** The hours counted as daylight, and where that came from. */
  daylight: Daylight;
  /** Resolved here so the slides and the settings beside them agree. */
  limits: Required<RowLimits>;
}

export interface StatsOptions {
  includeVideo: boolean;
  /**
   * Whether a year runs January to December, or from the day the library
   * starts. A slide setting rather than a config one: it is a way of looking
   * at the same photographs, not a fact about them.
   */
  yearBasis?: YearBasis;
  /** The day an anchor year begins. Usually the library start date. */
  anchorDay?: number | null;
  /** Camera and lens keys to leave out of every count. */
  excluded?: { cameras: string[]; lenses: string[] };
  /** How gear should be written. Applied here, never at index time. */
  naming?: NamingOptions;
  /** Which hours count as daylight on the clock slide. */
  daylight?: DaylightMode;
  /** Where the reader is, which beats any GPS in the photographs. */
  location?: Location | null;
  /** The hours "custom" means, as fractions: 6.5 is half past six. */
  daylightHours?: { sunrise: number; sunset: number };
  /** Which day the day-of-the-week slide starts on. */
  weekStart?: WeekStart;
  /** Whether the wall of days packs itself or takes a row per year. */
  wall?: WallLayout;
  /** Colour Saturday and Sunday differently from the working week. */
  markWeekend?: boolean;
  /** How many rows the slides that pool a tail should draw. */
  limits?: RowLimits;
  /**
   * The reader's saved milestones. Only those inside the range reach the deck:
   * a mark on a chart has to be somewhere the chart is drawing.
   */
  anchors?: readonly Anchor[];
  /** Which slides draw those milestones. Each has its own answer. */
  marks?: MarkToggles;
  /** Which kinds of milestone are worth drawing at all. One answer, deck-wide. */
  types?: TypeToggles;
  /** Which of the kit history's overlapping rows are folded together. */
  kit?: KitToggles;
  /** Which way each chart's bars run, by slide id. */
  layout?: Layouts;
}

/**
 * The predicate every slide shares. Built as a string with bound parameters
 * rather than interpolated values so the query plan is reused between ranges.
 *
 * `hideGear: false` drops the exclusions, which is how the tables list a hidden
 * camera alongside everything else — it has to be visible to be un-hidden.
 */
function scope(
  range: Range,
  options: StatsOptions,
  hideGear = true,
): { where: string; params: Array<number | string> } {
  const clauses = ["p.is_primary = 1", "p.present = 1", "p.day BETWEEN ? AND ?"];
  const params: Array<number | string> = [range.from, range.to];

  if (!options.includeVideo) clauses.push("p.kind <> 'video'");

  if (hideGear) {
    for (const [table, column, keys] of [
      ["camera", "camera_id", options.excluded?.cameras ?? []],
      ["lens", "lens_id", options.excluded?.lenses ?? []],
    ] as const) {
      if (keys.length === 0) continue;
      // A frame with no camera recorded is not the excluded camera, so it stays.
      clauses.push(
        `(p.${column} IS NULL OR p.${column} NOT IN (SELECT id FROM ${table} WHERE key IN (${keys.map(() => "?").join(", ")})))`,
      );
      params.push(...keys);
    }
  }

  return { where: clauses.join(" AND "), params };
}

/**
 * The years a range covers, as pairs of days.
 *
 * On the calendar basis these are January to December. On the anchor basis they
 * run from the anchor day — the day the library starts, usually the day a
 * camera was bought — so "year one" is the first twelve months of owning it
 * rather than whatever was left of the calendar.
 *
 * A range that begins mid-period keeps that short first period rather than
 * hiding it: it is a real year of the library, just an incomplete one.
 */
export function yearPeriods(
  range: Range,
  basis: YearBasis,
  anchorDay: number | null,
  today: number,
): Array<{ from: number; to: number; label: string; partial: boolean; remaining: number }> {
  const periods: Array<{
    from: number;
    to: number;
    label: string;
    partial: boolean;
    remaining: number;
  }> = [];

  /**
   * A year is still running if *its own* last day has not arrived yet — not if
   * the photographs stop short of it. Somebody who last shot in June is still
   * living in the same year in December, and the slide should say how much of
   * it is left rather than pretend it ended in June.
   */
  const left = (end: number) => Math.max(0, daysBetween(today, end));

  if (basis === "calendar" || anchorDay === null) {
    const firstYear = Math.floor(range.from / 10000);
    const lastYear = Math.floor(range.to / 10000);
    for (let year = firstYear; year <= lastYear; year++) {
      const end = makeDay(year, 12, 31);
      const from = Math.max(range.from, makeDay(year, 1, 1));
      const to = Math.min(range.to, end);
      if (from > to) continue;
      periods.push({ from, to, label: String(year), partial: end >= today, remaining: left(end) });
    }
    return periods;
  }

  const { month, day } = dayParts(anchorDay);
  // Step back to the anchor boundary at or before the range starts, so a range
  // that begins mid-year still lines its periods up with the anchor.
  let year = Math.floor(range.from / 10000);
  if (range.from < makeDay(year, month, day)) year -= 1;

  for (;;) {
    const start = makeDay(year, month, day);
    const end = addDays(makeDay(year + 1, month, day), -1);
    if (start > range.to) break;

    const from = Math.max(range.from, start);
    const to = Math.min(range.to, end);
    if (from <= to) {
      const a = String(year);
      const b = String(year + 1).slice(2);
      periods.push({
        from,
        to,
        label: `${a}–${b}`,
        partial: end >= today,
        remaining: left(end),
      });
    }
    year += 1;
    if (periods.length > 60) break;
  }

  return periods;
}

/** The month after this one, on a `YYYYMM` integer. */
const nextMonth = (ym: number) => (ym % 100 === 12 ? ym + 89 : ym + 1);

/**
 * Keeps the empty months at either end of the range.
 *
 * The run of months is deliberately not a ruler: a library with a three-year
 * break puts the years either side of it next to each other rather than
 * drawing thirty-six blank rows, and `monthRow` in `web/chart.js` knows how to
 * place a day falling in the hole. That compression is right in the middle of
 * a range and wrong at its ends — a range with no end of its own runs to
 * *today*, so stopping at the last month holding a frame quietly deletes the
 * dry spell, which is the thing that end date exists to show. A month by month
 * chart of 2025 that starts in March also says 2025 started in March.
 *
 * It cannot grow the run past the range itself, and a library that shot in
 * every month of it already produced exactly that many rows.
 */
function padToRange(months: MonthCount[], range: Range): MonthCount[] {
  const first = Math.floor(range.from / 100);
  const last = Math.floor(range.to / 100);
  if (last < first) return months;

  const head: MonthCount[] = [];
  const until = months[0]?.ym ?? nextMonth(last);
  for (let ym = first; ym < until; ym = nextMonth(ym)) head.push({ ym, shots: 0 });

  const tail: MonthCount[] = [];
  const after = months.length === 0 ? nextMonth(last) : nextMonth(months[months.length - 1]?.ym ?? last);
  for (let ym = after; ym <= last; ym = nextMonth(ym)) tail.push({ ym, shots: 0 });

  return head.length === 0 && tail.length === 0 ? months : [...head, ...months, ...tail];
}

/** An hour of the day, or the default when it is not one. */
function clampHour(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.min(24, Math.max(0, value));
}

/** Fixed windows, for a library with no GPS or a reader who prefers one. */
const FIXED_DAYLIGHT: Record<string, { sunrise: number; sunset: number }> = {
  "06-18": { sunrise: 6, sunset: 18 },
  "07-19": { sunrise: 7, sunset: 19 },
  "05-21": { sunrise: 5, sunset: 21 },
};

/**
 * The hours the clock slide shades as daylight.
 *
 * Asked for the sun, it uses where most of the photographs were taken and the
 * middle day of the range — one pair of hours for a period whose real sunrise
 * moved every day, which is a stylisation the slide says out loud. Polar
 * latitudes, where the sun may not rise at all, fall back to a fixed window
 * rather than pretending to an answer.
 */
/**
 * Which hours were lit, and where that answer came from.
 *
 * The reader's own location is preferred to anything in the photographs: GPS in
 * a frame says where a trip was, and a fortnight near the Arctic circle should
 * not decide what "after dark" means for a year shot at home. Frame GPS is only
 * a fallback for a library that has one and a reader who has not said where
 * they are, and the slide names whichever it used.
 */
function resolveDaylight(
  mode: DaylightMode | undefined,
  home: Location | null,
  fromFrames: Location | null,
  range: Range,
  hours?: { sunrise: number; sunset: number },
): Daylight {
  const fallback = { mode: "06-18" as DaylightMode, ...FIXED_DAYLIGHT["06-18"]!, source: "06:00 to 18:00" };
  const chosen = mode ?? "sun";

  if (chosen === "custom") {
    const window = { sunrise: clampHour(hours?.sunrise, 6), sunset: clampHour(hours?.sunset, 18) };
    return {
      mode: "custom",
      ...window,
      source: `${formatHour(window.sunrise)} to ${formatHour(window.sunset)}`,
    };
  }

  if (chosen !== "sun") {
    const fixed = FIXED_DAYLIGHT[chosen];
    if (!fixed) return fallback;
    return { mode: chosen, ...fixed, source: `${formatHour(fixed.sunrise)} to ${formatHour(fixed.sunset)}` };
  }

  const location = home ?? fromFrames;
  if (!location) return fallback;

  const middle = addDays(range.from, Math.floor(daysBetween(range.from, range.to) / 2));
  const times = sunTimes(location.lat, middle);
  if (!times) return fallback;

  const where =
    location.label && location.label !== ""
      ? location.label
      : `${Math.abs(location.lat).toFixed(1)}°${location.lat >= 0 ? "N" : "S"}`;

  return {
    mode: "sun",
    ...times,
    source: `${formatHour(times.sunrise)} to ${formatHour(times.sunset)} at ${where}`,
    from: home ? "you" : "frames",
  };
}

/** A gear row as stored: the tidied name, and what the camera actually wrote. */
interface RawNamed {
  label: string;
  make: string;
  model: string;
  raw_make: string | null;
  raw_model: string | null;
}

interface GearRow extends RawNamed {
  key: string;
  n: number;
  first: number;
  last: number;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Snaps raw values onto a standard scale and adds them up.
 *
 * The database groups by the value the camera wrote, which is f/7.1 and ISO 320
 * and 1/320s; a histogram of those is unreadable. Bucketing happens here rather
 * than in SQL because the scales are logarithmic and irregular.
 */
function distribute(
  rows: Array<{ value: number | null; n: number }>,
  bucketOf: (value: number | null) => number | null,
  labelOf: (value: number) => string,
  sort: "asc" | "desc" = "asc",
): Distribution {
  const counts = new Map<number, number>();
  let known = 0;

  for (const row of rows) {
    const bucket = bucketOf(row.value);
    if (bucket === null) continue;
    counts.set(bucket, (counts.get(bucket) ?? 0) + row.n);
    known += row.n;
  }

  const buckets: Bucket[] = [...counts.entries()]
    .map(([value, shots]) => ({ value, label: labelOf(value), shots }))
    .sort((a, b) => (sort === "asc" ? a.value - b.value : b.value - a.value));

  let favourite: Bucket | null = null;
  for (const bucket of buckets) {
    if (!favourite || bucket.shots > favourite.shots) favourite = bucket;
  }

  let median: number | null = null;
  let seen = 0;
  for (const bucket of buckets) {
    seen += bucket.shots;
    if (seen >= known / 2) {
      median = bucket.value;
      break;
    }
  }

  return { buckets, known, favourite, median };
}

/**
 * The whole list, never a truncated one.
 *
 * Collapsing a tail into "12 others" is a *drawing* decision — nine bars is a
 * chart and forty is a wall — so it happens in `stats/slides.ts`, against this
 * full list, which stays available for the table behind the slide.
 */
function tallies(
  rows: Array<{ key: string; label: string; n: number; first: number | null; last: number | null }>,
  known: number,
  excluded = false,
): Tally[] {
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    shots: row.n,
    share: known > 0 ? row.n / known : 0,
    firstDay: row.first,
    lastDay: row.last,
    excluded,
  }));
}

export function computeStats(db: Db, range: Range, options: StatsOptions): DeckStats {
  const { where, params: args } = scope(range, options);

  const totalsRow = db.getAs<Record<string, number | null>>(
    `SELECT
       COUNT(*) AS shots,
       SUM(p.kind = 'video') AS videos,
       SUM(p.kind = 'raw') AS raws,
       SUM(p.kind = 'photo') AS jpegs,
       SUM(CASE WHEN p.size > 0 THEN p.size ELSE 0 END) AS bytes,
       SUM(COALESCE(p.duration, 0)) AS videoSeconds,
       COUNT(DISTINCT p.day) AS daysShot,
       COUNT(DISTINCT p.camera_id) AS cameras,
       COUNT(DISTINCT p.lens_id) AS lenses,
       COUNT(DISTINCT p.body_serial) AS bodies,
       MIN(p.day) AS firstDay,
       MAX(p.day) AS lastDay,
       SUM(p.lat IS NOT NULL) AS withGps,
       SUM(p.flash = 1) AS withFlash,
       SUM(p.rating > 0) AS rated,
       SUM(p.rating >= 4 OR p.pick = 1) AS keepers
     FROM photo p WHERE ${where}`,
    ...args,
  );

  /**
   * Bytes, from wherever they can be had.
   *
   * A catalog knows what a photograph is but not how big its file is, so a
   * library indexed only from a Lightroom catalog has no sizes on the rows that
   * count — and the slide read "0 B". The fallback totals every row in range,
   * duplicates included, which is what "on disk" honestly means anyway.
   */
  const fallbackBytes = db.getAs<{ bytes: number | null }>(
    `SELECT SUM(CASE WHEN p.size > 0 THEN p.size ELSE 0 END) AS bytes FROM photo p
     WHERE p.present = 1 AND p.day BETWEEN ? AND ?`,
    range.from,
    range.to,
  );

  const filesRow = db.getAs<{ n: number }>(
    `SELECT COUNT(*) AS n FROM photo p
     WHERE p.present = 1 AND p.day BETWEEN ? AND ?${options.includeVideo ? "" : " AND p.kind <> 'video'"}`,
    range.from,
    range.to,
  );

  const previousShots =
    range.previous === null
      ? null
      : db.getAs<{ n: number }>(
          `SELECT COUNT(*) AS n FROM photo p WHERE ${where}`,
          range.previous.from,
          range.previous.to,
        )?.n ?? 0;

  const totals: Totals = {
    shots: num(totalsRow?.shots),
    files: num(filesRow?.n),
    stills: num(totalsRow?.shots) - num(totalsRow?.videos),
    videos: num(totalsRow?.videos),
    raws: num(totalsRow?.raws),
    jpegs: num(totalsRow?.jpegs),
    bytes: num(totalsRow?.bytes) || num(fallbackBytes?.bytes),
    videoSeconds: Math.round(num(totalsRow?.videoSeconds)),
    daysShot: num(totalsRow?.daysShot),
    daysInRange: range.days,
    cameras: num(totalsRow?.cameras),
    lenses: num(totalsRow?.lenses),
    bodies: num(totalsRow?.bodies),
    firstDay: totalsRow?.firstDay ?? null,
    lastDay: totalsRow?.lastDay ?? null,
    withGps: num(totalsRow?.withGps),
    withFlash: num(totalsRow?.withFlash),
    rated: num(totalsRow?.rated),
    keepers: num(totalsRow?.keepers),
    previousShots,
  };

  // ------------------------------------------------------------- gear ----

  // Labels are built here, from what the camera wrote, rather than read back
  // from what the indexer happened to think a good name was that day. That is
  // what lets a naming rule or a display setting change a library of two
  // hundred thousand photographs without re-reading a file.
  const naming = options.naming ?? DEFAULT_NAMING;
  const cameraName = (row: RawNamed) =>
    describeCamera(row.raw_make ?? row.make, row.raw_model ?? row.model, naming) || row.label;
  const lensName = (row: RawNamed) =>
    describeLens(row.raw_make ?? row.make, row.raw_model ?? row.model, naming) || row.label;

  const cameraRows = db.allAs<GearRow>(
    `SELECT c.key AS key, c.label AS label, c.make AS make, c.model AS model,
            c.raw_make AS raw_make, c.raw_model AS raw_model,
            COUNT(*) AS n, MIN(p.day) AS first, MAX(p.day) AS last
     FROM photo p JOIN camera c ON c.id = p.camera_id
     WHERE ${where} GROUP BY c.id ORDER BY n DESC, c.label`,
    ...args,
  ).map((row) => ({ ...row, label: cameraName(row) }));
  const cameraKnown = cameraRows.reduce((sum, row) => sum + row.n, 0);

  const lensRows = db.allAs<GearRow>(
    `SELECT l.key AS key, l.label AS label, l.make AS make, l.model AS model,
            l.raw_make AS raw_make, l.raw_model AS raw_model,
            COUNT(*) AS n, MIN(p.day) AS first, MAX(p.day) AS last
     FROM photo p JOIN lens l ON l.id = p.lens_id
     WHERE ${where} GROUP BY l.id ORDER BY n DESC, l.label`,
    ...args,
  ).map((row) => ({ ...row, label: lensName(row) }));

  // How each lens splits between bare and converted. One lens, one row; the
  // converter is a shade inside the bar.
  const tcRows = db.allAs<{ key: string; tc: string | null; n: number }>(
    `SELECT l.key AS key, p.tc AS tc, COUNT(*) AS n
     FROM photo p JOIN lens l ON l.id = p.lens_id
     WHERE ${where} GROUP BY l.id, p.tc`,
    ...args,
  );
  const lensParts = new Map<string, TeleconverterPart[]>();
  for (const row of tcRows) {
    const parts = lensParts.get(row.key) ?? [];
    parts.push({ tc: row.tc, shots: row.n });
    lensParts.set(row.key, parts);
  }
  for (const parts of lensParts.values()) {
    // Bare glass first, then the converters in order, so the shades step
    // outwards from the base colour the same way every time.
    parts.sort((a, b) => (a.tc === null ? -1 : b.tc === null ? 1 : a.tc.localeCompare(b.tc)));
  }
  const lensKnown = lensRows.reduce((sum, row) => sum + row.n, 0);

  // A pairing's name is built from the two names, so it follows the same
  // display rules rather than being assembled in SQL from stored labels.
  const comboRows = db
    .allAs<{
      key: string;
      cameraMake: string;
      cameraModel: string;
      lensMake: string;
      lensModel: string;
      label: string;
      n: number;
      first: number;
      last: number;
    }>(
      `SELECT c.key || '+' || l.key AS key,
              COALESCE(c.raw_make, c.make) AS cameraMake, COALESCE(c.raw_model, c.model) AS cameraModel,
              COALESCE(l.raw_make, l.make) AS lensMake, COALESCE(l.raw_model, l.model) AS lensModel,
              c.label || ' + ' || l.label AS label,
              COUNT(*) AS n, MIN(p.day) AS first, MAX(p.day) AS last
       FROM photo p JOIN camera c ON c.id = p.camera_id JOIN lens l ON l.id = p.lens_id
       WHERE ${where} GROUP BY c.id, l.id ORDER BY n DESC, label`,
      ...args,
    )
    .map((row) => ({
      ...row,
      label: `${describeCamera(row.cameraMake, row.cameraModel, naming)} + ${describeLens(row.lensMake, row.lensModel, naming)}`,
    }));
  const comboKnown = comboRows.reduce((sum, row) => sum + row.n, 0);

  // Pairings split by converter too. A body with a 200-600, and the same body
  // with the same lens behind a 1.4x, are one pairing used further away.
  const comboParts = new Map<string, TeleconverterPart[]>();
  for (const row of db.allAs<{ key: string; tc: string | null; n: number }>(
    `SELECT c.key || '+' || l.key AS key, p.tc AS tc, COUNT(*) AS n
     FROM photo p JOIN camera c ON c.id = p.camera_id JOIN lens l ON l.id = p.lens_id
     WHERE ${where} GROUP BY c.id, l.id, p.tc`,
    ...args,
  )) {
    const parts = comboParts.get(row.key) ?? [];
    parts.push({ tc: row.tc, shots: row.n });
    comboParts.set(row.key, parts);
  }
  for (const parts of comboParts.values()) {
    parts.sort((a, b) => (a.tc === null ? -1 : b.tc === null ? 1 : a.tc.localeCompare(b.tc)));
  }

  /**
   * Hidden gear, counted as if it were not hidden.
   *
   * These rows never reach a chart; they exist so the table behind the slide
   * can show what is being left out, and offer it back. A hidden camera you
   * cannot see is a hidden camera you cannot un-hide.
   */
  const hidden = (table: "camera" | "lens", keys: readonly string[]) => {
    if (keys.length === 0) return [];
    const open = scope(range, options, false);
    return db
      .allAs<GearRow>(
        `SELECT g.key AS key, g.label AS label, g.make AS make, g.model AS model,
                g.raw_make AS raw_make, g.raw_model AS raw_model,
                COUNT(*) AS n, MIN(p.day) AS first, MAX(p.day) AS last
         FROM photo p JOIN ${table} g ON g.id = p.${table}_id
         WHERE ${open.where} AND g.key IN (${keys.map(() => "?").join(", ")})
         GROUP BY g.id ORDER BY n DESC, g.label`,
        ...open.params,
        ...keys,
      )
      .map((row) => ({ ...row, label: table === "camera" ? cameraName(row) : lensName(row) }));
  };

  const hiddenCameras = hidden("camera", options.excluded?.cameras ?? []);
  const hiddenLenses = hidden("lens", options.excluded?.lenses ?? []);

  // ----------------------------------------------------- distributions ----

  // The barrel figure, not the 35mm equivalent: a photographer who owns one
  // system thinks in the numbers printed on the lens. The equivalent is used
  // for the angle-of-view split below, where comparing systems is the point.
  const focalRows = db.allAs<{ value: number; n: number }>(
    `SELECT ROUND(p.focal, 1) AS value, COUNT(*) AS n FROM photo p
     WHERE ${where} AND p.focal IS NOT NULL GROUP BY 1`,
    ...args,
  );

  const apertureRows = db.allAs<{ value: number; n: number }>(
    `SELECT ROUND(p.aperture, 2) AS value, COUNT(*) AS n FROM photo p
     WHERE ${where} AND p.aperture IS NOT NULL GROUP BY 1`,
    ...args,
  );

  const isoRows = db.allAs<{ value: number; n: number }>(
    `SELECT p.iso AS value, COUNT(*) AS n FROM photo p
     WHERE ${where} AND p.iso IS NOT NULL GROUP BY 1`,
    ...args,
  );

  const shutterRows = db.allAs<{ value: number; n: number }>(
    `SELECT p.shutter AS value, COUNT(*) AS n FROM photo p
     WHERE ${where} AND p.shutter IS NOT NULL GROUP BY 1`,
    ...args,
  );

  const classRows = db.allAs<{ value: number; n: number }>(
    `SELECT ROUND(COALESCE(p.focal35, p.focal), 1) AS value, COUNT(*) AS n FROM photo p
     WHERE ${where} AND (p.focal IS NOT NULL OR p.focal35 IS NOT NULL) GROUP BY 1`,
    ...args,
  );
  const classCounts = new Map<FocalClass, number>();
  for (const row of classRows) {
    const family = focalClass(row.value);
    if (family === null) continue;
    classCounts.set(family, (classCounts.get(family) ?? 0) + row.n);
  }

  // ------------------------------------------------------------ rhythm ----

  const hours = new Array<number>(24).fill(0);
  for (const row of db.allAs<{ hour: number; n: number }>(
    `SELECT p.hour AS hour, COUNT(*) AS n FROM photo p WHERE ${where} AND p.hour IS NOT NULL GROUP BY 1`,
    ...args,
  )) {
    if (row.hour >= 0 && row.hour < 24) hours[row.hour] = row.n;
  }

  const weekdays = new Array<number>(7).fill(0);
  for (const row of db.allAs<{ weekday: number; n: number }>(
    `SELECT p.weekday AS weekday, COUNT(*) AS n FROM photo p WHERE ${where} AND p.weekday IS NOT NULL GROUP BY 1`,
    ...args,
  )) {
    if (row.weekday >= 0 && row.weekday < 7) weekdays[row.weekday] = row.n;
  }

  const daily = db.allAs<{ day: number; shots: number }>(
    `SELECT p.day AS day, COUNT(*) AS shots FROM photo p WHERE ${where} GROUP BY p.day ORDER BY p.day`,
    ...args,
  );

  const monthly = padToRange(
    db
      .allAs<{ ym: number; shots: number }>(
        `SELECT p.ym AS ym, COUNT(*) AS shots FROM photo p WHERE ${where} AND p.ym IS NOT NULL GROUP BY p.ym ORDER BY p.ym`,
        ...args,
      )
      // Off the null-prototype rows and into plain objects, since the padding
      // below adds ones of its own and a mixed array is a trap for a test.
      .map((row) => ({ ym: row.ym, shots: row.shots })),
    range,
  );

  const busiestDay = daily.reduce<DayCount | null>(
    (best, day) => (best === null || day.shots > best.shots ? day : best),
    null,
  );

  // ---------------------------------------------------- gear over time ----

  const limits = resolveLimits(options.limits);
  const topLensKeys = lensRows.slice(0, limits.gear).map((row) => row.key);
  const months = monthly.map((row) => row.ym);
  const monthIndex = new Map(months.map((ym, i) => [ym, i]));
  const series: Series[] = [];

  if (topLensKeys.length > 0 && months.length > 1) {
    const byLens = new Map<string, { values: number[]; converted: number[] }>();
    for (const row of db.allAs<{ ym: number; key: string; tc: string | null; n: number }>(
      `SELECT p.ym AS ym, l.key AS key, p.tc AS tc, COUNT(*) AS n
       FROM photo p JOIN lens l ON l.id = p.lens_id
       WHERE ${where} AND p.ym IS NOT NULL GROUP BY p.ym, l.id, p.tc`,
      ...args,
    )) {
      const index = monthIndex.get(row.ym);
      if (index === undefined) continue;
      const key = topLensKeys.includes(row.key) ? row.key : "other";

      let entry = byLens.get(key);
      if (!entry) {
        entry = {
          values: new Array<number>(months.length).fill(0),
          converted: new Array<number>(months.length).fill(0),
        };
        byLens.set(key, entry);
      }
      entry.values[index] = (entry.values[index] ?? 0) + row.n;
      if (row.tc !== null) entry.converted[index] = (entry.converted[index] ?? 0) + row.n;
    }

    const toSeries = (label: string, entry: { values: number[]; converted: number[] }): Series =>
      entry.converted.some((n) => n > 0)
        ? { label, values: entry.values, converted: entry.converted }
        : { label, values: entry.values };

    for (const key of topLensKeys) {
      const entry = byLens.get(key);
      if (!entry) continue;
      series.push(toSeries(lensRows.find((row) => row.key === key)?.label ?? key, entry));
    }
    const other = byLens.get("other");
    if (other) series.push(toSeries("Everything else", other));
  }

  // ----------------------------------------------------------- keepers ----

  const ratings = new Array<number>(6).fill(0);
  for (const row of db.allAs<{ rating: number; n: number }>(
    `SELECT p.rating AS rating, COUNT(*) AS n FROM photo p WHERE ${where} AND p.rating IS NOT NULL GROUP BY 1`,
    ...args,
  )) {
    if (row.rating >= 0 && row.rating <= 5) ratings[row.rating] = row.n;
  }

  // Which way round a frame reads depends on the orientation flag as well as
  // the stored pixels — a portrait shot is a landscape file plus a rotation.
  const shape = db.getAs<{ landscape: number; portrait: number; square: number }>(
    `SELECT
       SUM(CASE WHEN p.width IS NULL OR p.height IS NULL OR p.width = p.height THEN 0
                WHEN p.orientation IN (5,6,7,8) THEN p.height > p.width
                ELSE p.width > p.height END) AS landscape,
       SUM(CASE WHEN p.width IS NULL OR p.height IS NULL OR p.width = p.height THEN 0
                WHEN p.orientation IN (5,6,7,8) THEN p.width > p.height
                ELSE p.height > p.width END) AS portrait,
       SUM(CASE WHEN p.width IS NOT NULL AND p.height IS NOT NULL AND p.width = p.height THEN 1 ELSE 0 END) AS square
     FROM photo p WHERE ${where}`,
    ...args,
  );

  // ------------------------------------------------------------ places ----

  // Rounded to a tenth of a degree — about 11km, which is a place rather than
  // an address, and keeps a scatter of a million frames to a few thousand dots.
  const places = db.allAs<{ lat: number; lon: number; shots: number }>(
    `SELECT ROUND(p.lat, 1) AS lat, ROUND(p.lon, 1) AS lon, COUNT(*) AS shots
     FROM photo p WHERE ${where} AND p.lat IS NOT NULL AND p.lon IS NOT NULL
     GROUP BY 1, 2 ORDER BY shots DESC LIMIT 4000`,
    ...args,
  );

  // ------------------------------------------------------------ debuts ----

  // First use ever, not first use in range: the point of the slide is "this is
  // the day you picked it up", which only reads right if it is actually true.
  const debuts: Debut[] = [];
  for (const [kind, table] of [
    ["camera", "camera"],
    ["lens", "lens"],
  ] as const) {
    for (const row of db.allAs<RawNamed & { key: string; day: number; n: number }>(
      `SELECT g.key AS key, g.label AS label, g.make AS make, g.model AS model,
              g.raw_make AS raw_make, g.raw_model AS raw_model,
              MIN(p.day) AS day, COUNT(*) AS n
       FROM photo p JOIN ${table} g ON g.id = p.${kind}_id
       WHERE p.is_primary = 1 AND p.present = 1 AND p.day IS NOT NULL
       GROUP BY g.id HAVING day BETWEEN ? AND ?`,
      range.from,
      range.to,
    )) {
      // Named the way every other slide names it, rather than by whatever the
      // indexer wrote the day it first saw the body.
      debuts.push({
        kind,
        key: row.key,
        label: kind === "camera" ? cameraName(row) : lensName(row),
        day: row.day,
        shots: row.n,
      });
    }
  }
  debuts.sort((a, b) => a.day - b.day || a.label.localeCompare(b.label));

  // --------------------------------------------------------- milestones ----

  const milestones = resolveMilestones(
    db,
    options.anchors ?? [],
    range,
    naming,
    { camera: cameraRows, lens: lensRows },
    { includeVideo: options.includeVideo ?? true },
  );

  // ------------------------------------------------------------ culling ----

  const flags = db.getAs<{ picked: number; rejected: number; unflagged: number }>(
    `SELECT SUM(p.pick = 1) AS picked,
            SUM(p.pick = -1) AS rejected,
            SUM(p.pick IS NULL OR p.pick = 0) AS unflagged
     FROM photo p WHERE ${where}`,
    ...args,
  );

  // Removals are not range-scoped: a deleted photograph has no capture date any
  // more, only the day it was noticed missing. The slide says so.
  const gone = db.getAs<{ removed: number; rejected: number; first: number | null }>(
    `SELECT COALESCE(SUM(removed), 0) AS removed,
            COALESCE(SUM(rejected), 0) AS rejected,
            MIN(at) AS first
     FROM removal`,
  );
  const firstSweep = db.getAs<{ at: number | null }>(
    "SELECT MIN(last_indexed_at) AS at FROM source WHERE last_indexed_at IS NOT NULL",
  );

  const culling: Culling = {
    picked: num(flags?.picked),
    rejected: num(flags?.rejected),
    unflagged: num(flags?.unflagged),
    removed: num(gone?.removed),
    removedRejected: num(gone?.rejected),
    watchingSince: firstSweep?.at ?? gone?.first ?? null,
  };

  // Three numbers per year, over whichever kind of year was asked for. One
  // small query per period — at most a couple of dozen, each a range scan on
  // the day index, which is cheaper and far clearer than date maths in SQL.
  const basis: YearBasis = options.yearBasis ?? "anchor";
  const periods = yearPeriods(range, basis, options.anchorDay ?? null, todayDay());
  const years: YearBucket[] = periods.map((period) => {
    const row = db.getAs<{ shots: number; cameras: number; lenses: number }>(
      `SELECT COUNT(*) AS shots, COUNT(DISTINCT p.camera_id) AS cameras,
              COUNT(DISTINCT p.lens_id) AS lenses
       FROM photo p WHERE ${where}`,
      period.from,
      period.to,
      ...args.slice(2),
    );
    return {
      ...period,
      shots: num(row?.shots),
      cameras: num(row?.cameras),
      lenses: num(row?.lenses),
    };
  });

  return {
    range,
    totals,
    cameras: tallies(cameraRows, cameraKnown),
    lenses: tallies(lensRows, lensKnown).map((tally) => {
      const parts = lensParts.get(tally.key) ?? [];
      // A single bare part is just the bar; only a real split is worth shading.
      return parts.length > 1 ? { ...tally, parts } : tally;
    }),
    combos: tallies(comboRows, comboKnown).map((tally) => {
      const parts = comboParts.get(tally.key) ?? [];
      return parts.length > 1 ? { ...tally, parts } : tally;
    }),
    hiddenCameras: tallies(hiddenCameras, cameraKnown, true),
    hiddenLenses: tallies(hiddenLenses, lensKnown, true),
    focal: distribute(focalRows, focalBucket, formatFocal),
    focalClasses: [...classCounts.entries()]
      .map(([label, shots]) => ({ label, shots }))
      .sort((a, b) => b.shots - a.shots),
    aperture: distribute(apertureRows, apertureBucket, formatAperture),
    iso: distribute(isoRows, isoBucket, formatIso),
    // Ascending seconds, so the axis reads fast to slow left to right.
    shutter: distribute(shutterRows, shutterBucket, formatShutter),
    hours,
    weekdays,
    // Always the whole list. It is one row per day the camera came out, which
    // is small even for twenty years, and the streaks slide needs it however
    // long the range is — the calendar is the one that switches to months.
    daily,
    monthly,
    timeline: { months, series },
    limits,
    ratings,
    orientation: {
      landscape: num(shape?.landscape),
      portrait: num(shape?.portrait),
      square: num(shape?.square),
    },
    busiestDay,
    longestStreak: longestRun(daily),
    longestGap: longestGap(daily),
    places,
    placesKnown: totals.withGps,
    debuts,
    milestones,
    burst: findLongestBurst(db, range, options),
    years,
    yearBasis: basis,
    // The cluster with the most frames in it. Good enough to ask the sun about,
    // and honest: it is where most of these photographs were taken.
    location: places[0] ?? null,
    culling,
    home: options.location ?? null,
    daylightHours: {
      sunrise: clampHour(options.daylightHours?.sunrise, 6),
      sunset: clampHour(options.daylightHours?.sunset, 18),
    },
    weekStart: options.weekStart ?? "mon",
    markWeekend: options.markWeekend ?? false,
    showMarks: resolveMarks(options.marks),
    showTypes: resolveTypes(options.types),
    kit: resolveKit(options.kit),
    layout: options.layout ?? {},
    wall: options.wall ?? "packed",
    daylight: resolveDaylight(
      options.daylight,
      options.location ?? null,
      places[0] ?? null,
      range,
      options.daylightHours,
    ),
  };
}

/** The longest unbroken run of days with at least one photograph. */
export function longestRun(daily: DayCount[]): Streak | null {
  if (daily.length === 0) return null;

  let best: Streak | null = null;
  let start = (daily[0] as DayCount).day;
  let previous = start;

  const close = (end: number) => {
    const days = daysBetween(start, end) + 1;
    if (best === null || days > best.days) best = { days, from: start, to: end };
  };

  for (const entry of daily.slice(1)) {
    if (daysBetween(previous, entry.day) === 1) {
      previous = entry.day;
      continue;
    }
    close(previous);
    start = entry.day;
    previous = entry.day;
  }
  close(previous);

  return best;
}

/** The longest stretch between two shooting days — the camera in the cupboard. */
export function longestGap(daily: DayCount[]): Streak | null {
  let best: Streak | null = null;

  for (let i = 1; i < daily.length; i++) {
    const from = (daily[i - 1] as DayCount).day;
    const to = (daily[i] as DayCount).day;
    const days = daysBetween(from, to) - 1;
    if (days > 0 && (best === null || days > best.days)) best = { days, from, to };
  }

  return best;
}

/**
 * The longest run of frames with no more than two seconds between them.
 *
 * Done in SQL because the alternative is pulling every capture time in the
 * range into memory. The window functions group consecutive rows per body: a
 * gap over the threshold starts a new group, and the running sum of those
 * marks is the group number.
 */
function findLongestBurst(db: Db, range: Range, options: StatsOptions): Burst | null {
  const { where, params } = scope(range, options);

  const row = db.getAs<{ frames: number; seconds: number; day: number; camera: string | null }>(
    `WITH ordered AS (
       SELECT p.epoch_sec AS t, p.day AS day, p.camera_id AS camera_id,
              LAG(p.epoch_sec) OVER (PARTITION BY p.camera_id ORDER BY p.epoch_sec) AS prev
       FROM photo p WHERE ${where} AND p.epoch_sec IS NOT NULL
     ),
     marked AS (
       SELECT t, day, camera_id, CASE WHEN prev IS NULL OR t - prev > 2 THEN 1 ELSE 0 END AS starts
       FROM ordered
     ),
     grouped AS (
       SELECT t, day, camera_id,
              SUM(starts) OVER (PARTITION BY camera_id ORDER BY t ROWS UNBOUNDED PRECEDING) AS burst
       FROM marked
     )
     SELECT COUNT(*) AS frames, MAX(t) - MIN(t) AS seconds, MIN(day) AS day,
            (SELECT c.label FROM camera c WHERE c.id = grouped.camera_id) AS camera
     FROM grouped GROUP BY camera_id, burst ORDER BY frames DESC, seconds LIMIT 1`,
    ...params,
  );

  if (!row || row.frames < 3) return null;
  return { frames: row.frames, seconds: row.seconds, day: row.day, camera: row.camera };
}

/**
 * Years that hold at least one photograph, newest first.
 *
 * The floor is the library start date. A year entirely before it holds nothing
 * this tool will report on, so offering it as a range would be a button that
 * produces an empty deck.
 */
export function availableYears(
  db: Db,
  floorDay: number | null = null,
): Array<{ year: number; shots: number }> {
  return db.allAs<{ year: number; shots: number }>(
    `SELECT year, COUNT(*) AS shots FROM photo
     WHERE is_primary = 1 AND present = 1 AND year IS NOT NULL AND day >= ?
     GROUP BY year ORDER BY year DESC`,
    floorDay ?? 0,
  );
}

/** Months that hold at least one photograph, newest first. */
export function availableMonths(
  db: Db,
  floorDay: number | null = null,
  limit = 24,
): Array<{ ym: number; shots: number }> {
  return db.allAs<{ ym: number; shots: number }>(
    `SELECT ym, COUNT(*) AS shots FROM photo
     WHERE is_primary = 1 AND present = 1 AND ym IS NOT NULL AND day >= ?
     GROUP BY ym ORDER BY ym DESC LIMIT ?`,
    floorDay ?? 0,
    limit,
  );
}

/**
 * Milestones inside the range, with the gear they point at looked up.
 *
 * Names come from the `camera` and `lens` tables rather than from a count, so a
 * milestone about gear that was never used inside this range still says what it
 * is about — you can buy a lens in March and not touch it until June. The
 * counts do come from the range, and from the same rows every other slide
 * counts, which is why a hidden camera's milestone reports nothing: hiding is
 * meant to remove a body from every number on every slide.
 */
function resolveMilestones(
  db: Db,
  anchors: readonly Anchor[],
  range: Range,
  naming: NamingOptions,
  rows: { camera: GearRow[]; lens: GearRow[] },
  options: { includeVideo?: boolean } = {},
): Milestone[] {
  // A trip that started before the range and ended inside it is a trip this
  // deck is partly about, so overlap rather than containment.
  const inRange = anchors.filter((a) => a.day <= range.to && (a.until ?? a.day) >= range.from);
  if (inRange.length === 0) return [];

  const names = new Map<string, string>();
  const counted = new Map<string, { shots: number; firstDay: number | null; lastDay: number | null }>();

  for (const [dimension, table, describe] of [
    ["camera", "camera", describeCamera],
    ["lens", "lens", describeLens],
  ] as const) {
    // The name table, not a count of it: a lens bought last week has no frames
    // on it yet and is still the lens it is.
    for (const row of db.allAs<RawNamed & { key: string }>(
      `SELECT key, label, make, model, raw_make, raw_model FROM ${table}`,
    )) {
      names.set(
        `${dimension}:${row.key}`,
        describe(row.raw_make ?? row.make, row.raw_model ?? row.model, naming) || row.label,
      );
    }
    for (const row of rows[dimension]) {
      counted.set(`${dimension}:${row.key}`, {
        shots: row.n,
        firstDay: row.first ?? null,
        lastDay: row.last ?? null,
      });
    }
  }

  // Converters are named by what they are — there is nothing else to call a
  // 1.4x — and counted straight off the frames that went through one.
  if (inRange.some((a) => a.gear?.dimension === "teleconverter")) {
    const { where, params } = scope(range, { includeVideo: true });
    for (const row of db.allAs<{ tc: string; n: number; first: number; last: number }>(
      `SELECT p.tc AS tc, COUNT(*) AS n, MIN(p.day) AS first, MAX(p.day) AS last
       FROM photo p WHERE ${where} AND p.tc IS NOT NULL GROUP BY p.tc`,
      ...params,
    )) {
      counted.set(`teleconverter:${row.tc}`, {
        shots: row.n,
        firstDay: row.first ?? null,
        lastDay: row.last ?? null,
      });
    }
  }

  /**
   * Frames inside each window, for the trips and the photoshoots.
   *
   * One query rather than one per milestone, and only when there is something
   * to count — the same shape as the converter branch above. The count is
   * clipped to the range, like everything else on a deck: a trip that started
   * before the range began contributes the part of it the deck is about.
   */
  const windows = new Map<string, number>();
  const windowed = inRange.filter((a) => WINDOWED_KINDS.includes(a.kind));
  if (windowed.length > 0) {
    const { where, params } = scope(range, { includeVideo: options.includeVideo ?? true });
    const perDay = new Map<number, number>();
    for (const row of db.allAs<{ day: number; n: number }>(
      `SELECT p.day AS day, COUNT(*) AS n FROM photo p WHERE ${where} GROUP BY p.day`,
      ...params,
    )) {
      perDay.set(row.day, row.n);
    }

    for (const anchor of windowed) {
      const from = Math.max(anchor.day, range.from);
      const to = Math.min(anchor.until ?? anchor.day, range.to);
      let total = 0;
      for (const [day, n] of perDay) if (day >= from && day <= to) total += n;
      windows.set(anchor.id, total);
    }
  }

  return inRange
    .map((anchor): Milestone => {
      const at = anchor.gear ? `${anchor.gear.dimension}:${anchor.gear.key}` : null;
      const label =
        at === null
          ? null
          : anchor.gear?.dimension === "teleconverter"
            ? `${anchor.gear.key} teleconverter`
            : (names.get(at) ?? null);

      return {
        id: anchor.id,
        label: anchor.label,
        day: anchor.day,
        until: anchor.until ?? anchor.day,
        kind: anchor.kind,
        shots: windows.has(anchor.id) ? (windows.get(anchor.id) ?? 0) : null,
        gear:
          anchor.gear && at !== null && label !== null
            ? {
                dimension: anchor.gear.dimension,
                key: anchor.gear.key,
                label,
                shots: counted.get(at)?.shots ?? 0,
                firstDay: counted.get(at)?.firstDay ?? null,
                lastDay: counted.get(at)?.lastDay ?? null,
              }
            : null,
      };
    })
    .sort((a, b) => a.day - b.day);
}

// ----------------------------------------------------------- catalog ------

/** One thing you own, as the milestone picker lists it. */
export interface GearItem {
  dimension: GearDimension;
  /** What a milestone points at. Never shown, never typed. */
  key: string;
  label: string;
  shots: number;
  firstDay: number | null;
  lastDay: number | null;
  /** For a converter, the glass it has been on — the only way to tell two apart. */
  note?: string;
}

export interface GearCatalog {
  cameras: GearItem[];
  lenses: GearItem[];
  /** Separate from the lenses on purpose: buying a 1.4x is its own purchase. */
  teleconverters: GearItem[];
}

/**
 * Everything the library has ever seen, one row per thing.
 *
 * Deliberately not scoped to a range, a start day or the exclusions: this is
 * the list of gear you have owned, and a milestone about a camera hidden from
 * the deck is still a milestone. It is also why the list can be short enough to
 * scroll — the keys have already collapsed every spelling of a name into one.
 */
export function gearCatalog(db: Db, naming: NamingOptions = DEFAULT_NAMING): GearCatalog {
  const shot = "p.is_primary = 1 AND p.present = 1";
  const rows = (table: "camera" | "lens") =>
    db.allAs<GearRow>(
      `SELECT g.key AS key, g.label AS label, g.make AS make, g.model AS model,
              g.raw_make AS raw_make, g.raw_model AS raw_model,
              COUNT(*) AS n, MIN(p.day) AS first, MAX(p.day) AS last
       FROM photo p JOIN ${table} g ON g.id = p.${table}_id
       WHERE ${shot} GROUP BY g.id ORDER BY n DESC, g.label`,
    );

  const item = (
    dimension: GearDimension,
    row: GearRow,
    label: string,
  ): GearItem => ({
    dimension,
    key: row.key,
    label,
    shots: row.n,
    firstDay: row.first ?? null,
    lastDay: row.last ?? null,
  });

  const cameras = rows("camera").map((row) =>
    item("camera", row, describeCamera(row.raw_make ?? row.make, row.raw_model ?? row.model, naming) || row.label),
  );
  const lenses = rows("lens").map((row) =>
    item("lens", row, describeLens(row.raw_make ?? row.make, row.raw_model ?? row.model, naming) || row.label),
  );

  // Which glass each converter has been behind. A 1.4x is a 1.4x in the data
  // whoever made it, so the lenses it has been on are what tells one from
  // another on a list.
  const behind = new Map<string, string[]>();
  for (const row of db.allAs<{ tc: string; key: string; make: string; model: string }>(
    `SELECT p.tc AS tc, l.key AS key,
            COALESCE(l.raw_make, l.make) AS make, COALESCE(l.raw_model, l.model) AS model,
            COUNT(*) AS n
     FROM photo p JOIN lens l ON l.id = p.lens_id
     WHERE ${shot} AND p.tc IS NOT NULL GROUP BY p.tc, l.id ORDER BY n DESC`,
  )) {
    const names = behind.get(row.tc) ?? [];
    names.push(describeLens(row.make, row.model, naming));
    behind.set(row.tc, names);
  }

  const teleconverters = db
    .allAs<{ tc: string; n: number; first: number | null; last: number | null }>(
      `SELECT p.tc AS tc, COUNT(*) AS n, MIN(p.day) AS first, MAX(p.day) AS last
       FROM photo p WHERE ${shot} AND p.tc IS NOT NULL GROUP BY p.tc ORDER BY n DESC`,
    )
    .map((row) => {
      const names = behind.get(row.tc) ?? [];
      const listed = names.slice(0, 2).join(" and ");
      return {
        dimension: "teleconverter" as const,
        key: row.tc,
        label: `${row.tc} teleconverter`,
        shots: row.n,
        firstDay: row.first ?? null,
        lastDay: row.last ?? null,
        ...(listed === ""
          ? {}
          : { note: names.length > 2 ? `On the ${listed}, and ${names.length - 2} more` : `On the ${listed}` }),
      };
    });

  return { cameras, lenses, teleconverters };
}

/**
 * A few of the reader's own lenses, named the way the settings currently say.
 *
 * For the naming panel, where the only way to know what a toggle does is to see
 * it happen — and to see it happen to a lens you own, not to an example from a
 * manual. The most decorated names are picked because they are the ones with
 * something to strip: a prime called `50mm` demonstrates nothing.
 *
 * The `lens` table, not a count over the photographs: this runs on every state
 * poll and a scan of two hundred thousand rows to fill in three strings would
 * be absurd.
 */
export function namingExamples(db: Db, naming: NamingOptions, limit = 3): string[] {
  const rows = db.allAs<RawNamed>("SELECT label, make, model, raw_make, raw_model FROM lens");

  // One body among the lenses, because the maker toggle is the one switch that
  // often has nothing to change about a lens: a catalog stores the lens model
  // with no make beside it, and then `Sony` was never in the name to remove.
  const body = db
    .allAs<RawNamed>("SELECT label, make, model, raw_make, raw_model FROM camera")
    .map((row) => ({
      label: describeCamera(row.raw_make ?? row.make, row.raw_model ?? row.model, naming) || row.label,
      shows:
        describeCamera(row.raw_make ?? row.make, row.raw_model ?? row.model, VERBATIM_NAMING) !==
        describeCamera(row.raw_make ?? row.make, row.raw_model ?? row.model, { ...VERBATIM_NAMING, showMake: false }),
    }))
    .sort((a, b) => Number(b.shows) - Number(a.shows) || a.label.length - b.label.length)[0];

  // Ranked by how many of the toggles would actually change the name, asked of
  // the rules themselves rather than guessed at: a phone's `back camera 5.1mm`
  // has an aperture and nothing else, and demonstrates one switch out of six.
  const parts: Array<keyof NamingOptions> = [
    "showMount",
    "showGrade",
    "showAperture",
    "showJargon",
    "showVersion",
  ];

  const seen = new Set<string>();
  return rows
    .map((row) => {
      const make = row.raw_make ?? row.make;
      const model = row.raw_model ?? row.model;
      const verbatim = describeLens(make, model, VERBATIM_NAMING);

      return {
        label: describeLens(make, model, naming) || row.label,
        shows: parts.filter(
          (key) => applyNaming(verbatim, { ...VERBATIM_NAMING, [key]: false }) !== verbatim,
        ).length,
      };
    })
    .sort((a, b) => b.shows - a.shows || a.label.length - b.label.length)
    .filter((entry) => entry.label !== "" && !seen.has(entry.label) && seen.add(entry.label) !== undefined)
    .slice(0, body ? limit - 1 : limit)
    .map((entry) => entry.label)
    .concat(body && body.label !== "" ? [body.label] : []);
}

/** Used by the day-detail line under a heatmap cell. */
export function describeDay(day: number): string {
  return formatDay(day);
}
