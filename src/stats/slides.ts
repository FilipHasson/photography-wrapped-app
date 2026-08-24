import { HEATMAP_MAX_DAYS, MAX_ROWS as MAX_BARS, MAX_SERIES, MARK_TYPES, markTypeOf } from "./aggregate.ts";
import type {
  DeckStats,
  DayCount,
  Debut,
  MarkToggles,
  MarkType,
  Milestone,
  Orientation,
  Place,
  Series,
  Streak,
  Totals,
  WallLayout,
  WeekStart,
  YearBucket,
} from "./aggregate.ts";
import { daysBetween, formatDay, formatYearMonth, monthsBetween, WEEKDAYS } from "../core/time.ts";

/**
 * Turning numbers into slides.
 *
 * The split matters: this module decides *what a slide says*, the browser
 * decides what it looks like. Every headline is written here, against the real
 * figures, so there is one place to check that the deck never claims something
 * the data does not support — and slides with nothing to say are dropped rather
 * than rendered empty.
 */

/**
 * A row the reader can switch off.
 *
 * One iPhone frame imported into a catalog is a whole camera as far as the data
 * is concerned, and it lands on the "cameras" slide beside a body with forty
 * thousand frames. Hiding it takes its frames out of *every* count, not just
 * off that one chart, which is why the key travels with the row.
 */
export interface RowKey {
  dimension: "camera" | "lens";
  key: string;
  excluded: boolean;
}

export interface SlideTable {
  columns: string[];
  /** Every row behind the slide, including the tail the chart folded away. */
  rows: Array<Array<string | number>>;
  /** Parallel to `rows`; `null` for a row that is not a piece of gear. */
  rowKeys?: Array<RowKey | null>;
}

export interface Tile {
  label: string;
  value: string;
  note?: string;
}

/**
 * A choice that belongs to one slide.
 *
 * Not everything is a library-wide setting. Whether a year runs from January or
 * from the day the camera arrived changes one slide and nothing else, so it
 * lives beside that slide rather than in a settings panel three screens away.
 * Changing it rebuilds the deck with the choice in the query.
 */
export interface SlideSetting {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string; note?: string }>;
  /**
   * Two clock pickers under the options, for a choice a row of chips cannot
   * make: "daylight is these hours" needs the hours themselves. Shown only when
   * the option that wants them is the one selected.
   */
  hours?: { shownWhen: string; fromId: string; from: number; toId: string; to: number };
}

/**
 * A milestone as a chart draws it.
 *
 * Two forms of the same thing: `label` is what fits on a chart, `full` is what
 * the reader wrote. A mark is context — it never becomes a series, and it never
 * takes a colour.
 */
export interface Mark {
  day: number;
  /**
   * The last day it covers, when that is not the first.
   *
   * A trip is a fortnight, not a moment, and a hairline through the middle of
   * one says the wrong thing. Absent on everything else, so a renderer that
   * does not know about spans keeps drawing exactly what it drew before.
   */
  until?: number;
  /** Short enough to sit above an axis: `+ FE 200-600mm G`. */
  label: string;
  /** The whole milestone, for the hover title. */
  full: string;
}

interface Common {
  id: string;
  title: string;
  /**
   * Milestones falling inside what this slide draws.
   *
   * Only the slides whose x axis is time read it; the rest ignore it. It lives
   * on every slide rather than on three of them because which slides can carry
   * a mark is a drawing decision, not a shape of data.
   */
  marks?: Mark[];
  /**
   * Which way the bars run, for the slides that have bars. Absent on the rest,
   * and the renderers that do not draw bars ignore it.
   */
  orientation?: Orientation;
  /** Choices this slide offers, rendered beside it. */
  settings?: SlideSetting[];
  /** The one sentence the slide exists to deliver. */
  headline: string;
  subtitle?: string;
  /** Caveats, denominators, and anything else that keeps the claim honest. */
  note?: string;
  /** Every value on the slide, readable as text. Never optional. */
  table: SlideTable;
}

export type Slide =
  | (Common & { kind: "hero"; value: string; caption?: string; tiles: Tile[] })
  | (Common & {
      kind: "bars";
      items: Array<{
        label: string;
        value: number;
        valueLabel: string;
        share: number;
        muted?: boolean;
        /**
         * The bar split by teleconverter. One lens is one bar; the converter is
         * a shade inside it, because a 200-600 with a 1.4x on the back is the
         * same lens being used further away.
         */
        segments?: Array<{ label: string; value: number }>;
      }>;
      /** Names the shades, when any bar has them. */
      legend?: string[];
    })
  | (Common & {
      kind: "columns";
      items: Array<{ label: string; value: number }>;
      highlight: number;
      axisLabel: string;
    })
  | (Common & {
      kind: "strip";
      /** One mark per day across the range, shot or not. */
      days: DayCount[];
      from: number;
      to: number;
      streak: Streak | null;
      gap: Streak | null;
      /** The years the range covers: a row each, or labels along the wall. */
      years: Array<{ label: string; from: number; to: number }>;
      /**
       * "packed" fills the slide, "years" gives each year its own row, and
       * "months" is a block per month with the days on their real weekdays.
       */
      layout: WallLayout;
    })
  | (Common & {
      kind: "years";
      /** One row of cards per year: photographs, cameras, lenses. */
      years: YearBucket[];
    })
  | (Common & {
      kind: "clock";
      hours: number[];
      /** The hours the shading treats as daylight, as fractional hours. */
      sunrise: number;
      sunset: number;
    })
  | (Common & {
      kind: "week";
      days: number[];
      /** Day names in the order they are drawn, the reader's week start first. */
      labels: string[];
      /** Which of those positions are the weekend, when it is being marked. */
      weekend: number[];
    })
  | (Common & { kind: "calendar"; days: DayCount[]; from: number; to: number })
  | (Common & { kind: "months"; months: Array<{ ym: number; shots: number }> })
  | (Common & { kind: "stack"; months: number[]; series: Series[] })
  | (Common & { kind: "map"; points: Place[] })
  | (Common & {
      kind: "verdict";
      /**
       * The judgements, side by side, each with the gesture that made it.
       *
       * A verdict is not a category and not a magnitude — it is a judgement,
       * and judgements read faster as cards than as columns of a bar chart
       * nobody needs to measure against an axis. Two cards for a pick or a
       * reject; five for a rating, which is the same slide with a different
       * gesture on it.
       *
       * The gesture is described rather than named, because it is drawn: a
       * `★` from a system font is at the mercy of whatever the export
       * rasteriser has installed, and an emoji star may not appear at all.
       */
      cards: Array<{
        glyph: { kind: "thumb"; up: boolean } | { kind: "stars"; count: number };
        label: string;
        value: string;
        note: string;
      }>;
      /** The pile that was never judged either way, under them. */
      rest: { label: string; value: string; note: string };
    })
  | (Common & { kind: "tiles"; tiles: Tile[] })
  | (Common & { kind: "list"; items: Array<{ label: string; meta: string; value: string }> });

export interface Deck {
  title: string;
  subtitle: string;
  rangeLabel: string;
  slides: Slide[];
  /** True when there was nothing to build a deck from. */
  empty: boolean;
}

// ----------------------------------------------------------- formatting ----

const INTEGER = new Intl.NumberFormat("en-US");

export const fmtInt = (n: number): string => INTEGER.format(Math.round(n));

export function fmtPct(fraction: number, places = 0): string {
  if (!Number.isFinite(fraction)) return "—";
  const value = fraction * 100;
  // A rounded 0% next to a non-zero count reads as a bug, so keep one digit
  // until the number really is nothing.
  if (value > 0 && value < 1) return "<1%";
  return `${value.toFixed(places)}%`;
}

export function fmtBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function fmtDuration(seconds: number): string {
  if (seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);

/**
 * A span of days, said the way people say it.
 *
 * Days up to a month and a half, then months, then years — nobody says "eight
 * hundred and forty days", and nobody means 2.3 years either.
 */
export function fmtSpan(days: number): string {
  if (!Number.isFinite(days) || days < 0) return "—";
  if (days < 45) return `${fmtInt(days)} ${plural(days, "day")}`;

  const months = Math.max(1, Math.round(days / 30.44));
  if (months < 24) return `${months} ${plural(months, "month")}`;

  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0
    ? `${years} ${plural(years, "year")}`
    : `${years} ${plural(years, "year")} ${rest} ${plural(rest, "month")}`;
}

/**
 * A milestone at chart size.
 *
 * "Bought the FE 200-600mm G" is a sentence and a chart has room for a name, so
 * the verb becomes a sign. A milestone about nothing in particular keeps its own
 * words — there is nothing else it could say.
 */
function markLabel(milestone: Milestone): string {
  const name = milestone.gear?.label;
  if (milestone.kind === "bought") return `+ ${name ?? milestone.label.replace(/^bought (the )?/i, "")}`;
  if (milestone.kind === "sold") return `− ${name ?? milestone.label.replace(/^sold (the )?/i, "")}`;
  return milestone.label;
}

/**
 * The whole milestone, for the hover.
 *
 * A trip says its span and what came out of it, because that is the entire
 * reason it is a kind of its own rather than a dated phrase — "Iceland · 3 to
 * 17 Mar 2025 · 1,204 photographs" is a fact, and "Iceland" is a caption.
 */
function markTitle(milestone: Milestone): string {
  const when =
    milestone.until > milestone.day
      ? `${formatDay(milestone.day)} to ${formatDay(milestone.until)}`
      : formatDay(milestone.day);

  const took =
    milestone.shots === null ? "" : ` · ${fmtInt(milestone.shots)} ${plural(milestone.shots, "photograph")}`;

  return `${milestone.label} · ${when}${took}`;
}

/** Whether this milestone's kind is one the reader still wants to see. */
const shownType = (stats: DeckStats) => (milestone: Milestone) =>
  stats.showTypes[markTypeOf(milestone.kind)];

/**
 * Marks for the slides that draw time, or nothing at all.
 *
 * Annotation is a way of looking rather than a fact about the library, so it is
 * a slide setting like the rest: someone reading the shape of a year does not
 * always want to be told why it has that shape.
 */
function marksFor(stats: DeckStats, slide: keyof MarkToggles): Mark[] | undefined {
  if (stats.milestones.length === 0 || !stats.showMarks[slide]) return undefined;
  return stats.milestones.filter(shownType(stats)).map((milestone) => ({
    day: milestone.day,
    ...(milestone.until > milestone.day ? { until: milestone.until } : {}),
    label: markLabel(milestone),
    full: markTitle(milestone),
  }));
}

/** `2,481 photographs` — the phrase that appears in half the headlines. */
const shotsPhrase = (n: number): string => `${fmtInt(n)} ${plural(n, "photograph")}`;

/**
 * Photographs taken, which is not the same as photographs in the library.
 *
 * The reader's own count of what they deleted before this tool first looked is
 * part of what they shot and part of nothing else — it has no day, no camera
 * and no exposure behind it. So it is added here, by the two slides that
 * answer "how many photographs", and by no denominator anywhere: a share is
 * still a share of `totals.shots`. See `Totals.deletedBefore`.
 */
const taken = (totals: Totals): number => totals.shots + totals.deletedBefore;

function tableOf(columns: string[], rows: Array<Array<string | number>>): SlideTable {
  return { columns, rows };
}

// ---------------------------------------------------------------- deck -----

export function buildDeck(stats: DeckStats, ownerName = ""): Deck {
  const slides: Slide[] = [];
  const { totals, range } = stats;

  const owner = ownerName.trim();
  const possessive = owner === "" ? "" : owner.endsWith("s") ? `${owner}'` : `${owner}'s`;
  const title =
    range.spec.kind === "all"
      ? owner === "" ? "Everything, so far" : `${possessive} photography, so far`
      : // A milestone is already a phrase someone wrote — "Since bought the a9
        // III" — and a possessive in front of it never reads right.
        range.spec.kind === "since" || owner === ""
        ? range.label
        : `${possessive} ${range.label}`;

  if (totals.shots === 0) {
    return {
      title,
      subtitle: range.label,
      rangeLabel: range.label,
      empty: true,
      slides: [
        {
          kind: "hero",
          id: "empty",
          title: range.label,
          headline: "Nothing here yet",
          value: "0",
          caption: "photographs in this range",
          subtitle:
            totals.daysInRange > 0
              ? `Nothing was shot between ${formatDay(range.from)} and ${formatDay(range.to)}.`
              : undefined,
          note: "Try a wider range, or index another source.",
          tiles: [],
          table: tableOf(["Range", "Photographs"], [[range.label, 0]]),
        },
      ],
    };
  }

  slides.push(opening(stats, range.label));

  const perYear = yearsSlide(stats);
  if (perYear) slides.push(perYear);

  const gear = [
    ranked(stats, "cameras", "Cameras", "The body you actually reach for"),
    ranked(stats, "lenses", "Lenses", "The glass that did the work"),
    ranked(stats, "combos", "Pairings", "Body and lens, together"),
  ];
  for (const slide of gear) if (slide) slides.push(slide);

  const distributions = [
    focalSlide(stats),
    apertureSlide(stats),
    isoSlide(stats),
    shutterSlide(stats),
  ];
  for (const slide of distributions) if (slide) slides.push(slide);

  const rhythm = [
    clockSlide(stats),
    weekSlide(stats),
    calendarSlide(stats),
    streaksSlide(stats),
    timelineSlide(stats),
  ];
  for (const slide of rhythm) if (slide) slides.push(slide);

  const extras = [
    cullingSlide(stats),
    keepersSlide(stats),
    shapeSlide(stats),
    placesSlide(stats),
    kitSlide(stats),
    debutsSlide(stats),
    burstSlide(stats),
  ];
  for (const slide of extras) if (slide) slides.push(slide);

  slides.push(closing(stats));

  return { title, subtitle: range.label, rangeLabel: range.label, slides, empty: false };
}

// -------------------------------------------------------------- slides -----

function opening(stats: DeckStats, rangeLabel: string): Slide {
  const { totals, range } = stats;
  const shot = taken(totals);
  // Per *day*, so the frames with no day cannot be in it. Same for the week
  // below, and for every tile beside them.
  const perDay = totals.daysShot > 0 ? totals.shots / totals.daysShot : 0;

  const tiles: Tile[] = [
    { label: "Days out shooting", value: fmtInt(totals.daysShot), note: `of ${fmtInt(totals.daysInRange)}` },
    { label: "Busiest average", value: `${perDay.toFixed(0)}/day`, note: "on days you shot" },
    {
      label: "Cameras",
      value: fmtInt(totals.cameras),
      note: totals.lenses > 0 ? `${fmtInt(totals.lenses)} ${plural(totals.lenses, "lens", "lenses")}` : undefined,
    },
  ];

  // A catalog-only library knows nothing about file sizes, and a tile reading
  // "0 B" is worse than a tile that is not there.
  if (totals.bytes > 0) {
    tiles.push({ label: "On disk", value: fmtBytes(totals.bytes), note: `${fmtInt(totals.files)} files` });
  } else if (totals.daysInRange >= 14) {
    const perWeek = (totals.shots / totals.daysInRange) * 7;
    tiles.push({ label: "A week", value: `${Math.round(perWeek)}`, note: "photographs, on average" });
  }

  /**
   * The period, not the frames inside it.
   *
   * This used to be the first and last frame, which read as the period and was
   * not: an all-time deck ending today said "16 Aug 2026" on the 24th, and
   * every other number on the slide — days in range, the share of the period,
   * the clause naming the period before — was already measuring something
   * else. The first and last frame are still worth knowing, and they are in
   * the table, which is where a detail that is not the headline belongs.
   */
  let subtitle = `${formatDay(range.from)} — ${formatDay(range.to)}`;
  if (totals.previousShots !== null && range.previous) {
    const previous = totals.previousShots;
    if (previous === 0) {
      subtitle += ` · nothing at all in ${range.previous.label}`;
    } else {
      const change = (totals.shots - previous) / previous;
      const direction = change >= 0 ? "up" : "down";
      subtitle += ` · ${direction} ${fmtPct(Math.abs(change))} on ${range.previous.label}`;
    }
  }

  return {
    kind: "hero",
    id: "opening",
    title: rangeLabel,
    headline: shotsPhrase(shot),
    value: fmtInt(shot),
    caption: totals.videos > 0
      ? `photographs and ${fmtInt(totals.videos)} ${plural(totals.videos, "clip")}`
      : plural(shot, "photograph"),
    subtitle,
    tiles,
    // Footnotes are a phrase, never a paragraph, and never a count of frames —
    // the numbers are the slide, and every denominator is in the table view.
    // The date itself is in the subtitle now, so this says what it is instead
    // of repeating it: "All time" starting in 2023 needs explaining, not a
    // second copy of the day it starts on.
    note: range.clipped ? "Your start date, not your first photograph" : undefined,
    table: tableOf(
      ["Measure", "Value"],
      [
        ["Photographs", shot],
        // Only where the two differ. The headline counts everything that was
        // shot; these two say how that number is made up, which is exactly the
        // kind of detail the table exists for.
        ...(totals.deletedBefore > 0
          ? [
              ["Still in the library", totals.shots],
              ["Deleted before indexing", totals.deletedBefore],
            ]
          : []),
        ["Files", totals.files],
        ["First frame", totals.firstDay ? formatDay(totals.firstDay) : "—"],
        ["Last frame", totals.lastDay ? formatDay(totals.lastDay) : "—"],
        ["Days shot", totals.daysShot],
        ["Days in range", totals.daysInRange],
        ["Cameras", totals.cameras],
        ["Lenses", totals.lenses],
        ["On disk", fmtBytes(totals.bytes)],
      ],
    ),
  };
}

/**
 * A year at a time: three numbers each, as cards rather than a chart.
 *
 * Three series of two or three points is not a chart — it is nine numbers, and
 * a chart of it would be harder to read than the numbers themselves. Cards say
 * them plainly, one row per year.
 *
 * The years can run from January or from the day the library starts, which is a
 * choice about how to look rather than a fact about the photographs — so it is
 * a setting on the slide.
 */
/**
 * How much of the year is left, for the year that has not finished.
 *
 * "2026" beside "2025" reads as a year that came up short until it says why —
 * and "still running" says why without saying how much, which is the number
 * anyone actually wants: four months left is a different slide from four days.
 */
function runningNote(years: YearBucket[]): string | undefined {
  const running = years.find((year) => year.partial);
  if (!running) return undefined;
  if (running.remaining <= 0) return `${running.label} ends today`;
  if (running.remaining === 1) return `One day left in ${running.label}`;
  return `${fmtInt(running.remaining)} days left in ${running.label}`;
}

/**
 * Whether a year runs from January or from the day the library starts.
 *
 * Shared by the two slides that split a range into years, so answering it on
 * one answers it on both: they would look absurd disagreeing with each other.
 */
/**
 * The milestone toggle, shared by every slide that can carry one.
 *
 * Offered only where there is something to show: a chip that hides nothing is
 * a chip that teaches the reader the settings are decoration.
 */
/**
 * Which way this slide's bars run, and the chip that changes it.
 *
 * Every chart has a natural orientation — the one it was designed around and
 * the one it uses when nobody has said otherwise — and the setting is an
 * override of that rather than a choice with no default. A lens name reads
 * beside a bar; a shutter-speed histogram reads standing up; and which of those
 * is true of *your* library on *your* screen is not something this can know.
 */
function orientationOf(stats: DeckStats, id: string, natural: Orientation): Orientation {
  return stats.layout[id] ?? natural;
}

function orientationSetting(stats: DeckStats, id: string, natural: Orientation): SlideSetting {
  return {
    id: `layout.${id}`,
    label: "Bars run",
    value: orientationOf(stats, id, natural),
    options: [
      { value: "rows", label: "Across", note: "a row each" },
      { value: "columns", label: "Upright", note: "a column each" },
    ],
  };
}

/** The settings a slide actually has, dropped entirely when it has none. */
function settingsOf(...offered: Array<SlideSetting | null>): { settings?: SlideSetting[] } {
  const settings = offered.filter((setting): setting is SlideSetting => setting !== null);
  return settings.length > 0 ? { settings } : {};
}

/**
 * One switch per kind of milestone, deck-wide.
 *
 * Offered beside every slide that draws marks — the same setting, built by one
 * function, exactly as `yearBasisSetting` is shared by the years slide and the
 * wall. Two chips disagreeing about whether trips are shown would be worse than
 * having no chips at all.
 *
 * Only for kinds the range actually holds, and only when it holds more than
 * one: filtering to the single kind you have is a control that can only ever
 * make the chart worse.
 */
function typeSettings(stats: DeckStats, slide: keyof MarkToggles): SlideSetting[] {
  if (!stats.showMarks[slide] || stats.milestones.length === 0) return [];

  const present = MARK_TYPES.filter((type) =>
    stats.milestones.some((milestone) => markTypeOf(milestone.kind) === type),
  );
  if (present.length < 2) return [];

  return present.map((type) => {
    const count = stats.milestones.filter((m) => markTypeOf(m.kind) === type).length;
    return {
      id: `type.${type}`,
      label: TYPE_LABELS[type],
      value: stats.showTypes[type] ? "on" : "off",
      options: [
        { value: "on", label: "Shown", note: `${fmtInt(count)} in this range` },
        { value: "off", label: "Hidden" },
      ],
    };
  });
}

const TYPE_LABELS: Record<MarkType, string> = {
  gear: "Gear you bought and sold",
  trip: "Trips",
  shoot: "Photoshoots",
  custom: "Everything else",
};

function marksSetting(stats: DeckStats, slide: keyof MarkToggles): SlideSetting | null {
  // What the switch would actually turn on, which is not every milestone once
  // a type can be hidden: "42 in this range" beside a chart showing six is a
  // chip that has stopped describing the thing it controls.
  const count = stats.milestones.filter(shownType(stats)).length;
  if (stats.milestones.length === 0) return null;

  return {
    id: `marks.${slide}`,
    label: "Milestones",
    value: stats.showMarks[slide] ? "on" : "off",
    options: [
      { value: "on", label: "Shown", note: `${fmtInt(count)} in this range` },
      { value: "off", label: "Hidden" },
    ],
  };
}

/**
 * Whether the kit history folds its overlapping rows together.
 *
 * Offered only when something actually repeats, and asked of the milestones
 * rather than of the setting: a switch that disappears the moment you turn it
 * off is a switch you cannot turn back on.
 */
function combineSetting(stats: DeckStats): SlideSetting {
  return {
    id: "kit.combine",
    label: "The same thing twice",
    value: stats.kit.combine ? "on" : "off",
    options: [
      { value: "on", label: "One row", note: "the purchase and the sale together" },
      { value: "off", label: "A row each" },
    ],
  };
}

function ownershipSetting(stats: DeckStats): SlideSetting {
  return {
    id: "kit.ownership",
    label: "How long you kept things",
    value: stats.kit.ownership ? "on" : "off",
    options: [
      { value: "on", label: "Shown", note: "the shortest you kept anything" },
      { value: "off", label: "Hidden" },
    ],
  };
}

function yearBasisSetting(stats: DeckStats): SlideSetting {
  const first = stats.years[0];
  return {
    id: "yearBasis",
    label: "A year runs",
    value: stats.yearBasis,
    options: [
      {
        value: "anchor",
        label: "From my start date",
        note: first ? `${formatDay(first.from)} onwards` : undefined,
      },
      { value: "calendar", label: "January to December" },
    ],
  };
}

function yearsSlide(stats: DeckStats): Slide | null {
  const years = stats.years.filter((year) => year.shots > 0);
  // One year is the opening slide with extra steps.
  if (years.length < 2) return null;

  const busiest = years.reduce((best, year) => (year.shots > best.shots ? year : best));

  return {
    kind: "years",
    id: "years",
    title: "Year by year",
    subtitle: stats.yearBasis === "anchor" ? "Years from your start date" : "Calendar years",
    headline:
      busiest.shots > 0
        ? `${busiest.label} was your busiest year — ${shotsPhrase(busiest.shots)}`
        : "Year by year",
    note: runningNote(years),
    settings: [yearBasisSetting(stats)],
    years,
    table: tableOf(
      ["Year", "From", "To", "Photographs", "Cameras", "Lenses"],
      years.map((year) => [
        year.label,
        formatDay(year.from),
        formatDay(year.to),
        year.shots,
        year.cameras,
        year.lenses,
      ]),
    ),
  };
}

/**
 * How many rows to draw, offered beside every slide that pools a tail.
 *
 * Eight bars is a default rather than a rule: someone with four lenses and
 * someone with thirty want different slides out of the same code, and the one
 * who owns the library is the one who knows which. The ladder is trimmed to the
 * list it applies to — offering "top 20" to somebody with eleven lenses is
 * offering them the same slide twice — and the top of it is always the whole
 * list, so the chart can be made to agree with the table.
 */
function rowsSetting(field: string, total: number, value: number, ceiling: number): SlideSetting | null {
  // Two rows and a tail of one is not a decision worth offering.
  if (total < 4) return null;

  const most = Math.min(total, ceiling);
  // Asking for more rows than exist is the same slide as asking for all of
  // them, and the chip that is on has to be one the reader can see.
  const current = Math.min(value, most);
  const steps = [...new Set([3, 5, 8, 12, 16, 20, 25, 30, current].filter((n) => n < most))].sort(
    (a, b) => a - b,
  );

  return {
    id: `rows.${field}`,
    label: "How many to show",
    value: String(current),
    options: [
      ...steps.map((n) => ({ value: String(n), label: `Top ${n}` })),
      {
        value: String(most),
        label: most === total ? `All ${total}` : `Top ${most}`,
        note: most === total ? "nothing pooled" : `the most this chart can hold`,
      },
    ],
  };
}

/** Cameras, lenses and pairings differ only in wording, so they share a shape. */
function ranked(
  stats: DeckStats,
  field: "cameras" | "lenses" | "combos",
  title: string,
  subtitle: string,
): Slide | null {
  const rows = stats[field];
  if (rows.length === 0) return null;

  const known = rows.reduce((sum, row) => sum + row.shots, 0);
  const top = rows[0];
  if (!top) return null;

  // Drawn: the leaders, then everything else as one bar. A lens used with a
  // teleconverter keeps its own row and carries the split inside the bar.
  const limit = stats.limits[field];
  const drawn = rows.slice(0, limit).map((row) => ({
    label: row.label,
    value: row.shots,
    valueLabel: `${fmtInt(row.shots)}  ·  ${fmtPct(row.share)}`,
    share: row.share,
    muted: false,
    ...(row.parts && row.parts.length > 1
      ? {
          segments: row.parts.map((part) => ({
            label: part.tc === null ? "bare" : `with ${part.tc}`,
            value: part.shots,
          })),
        }
      : {}),
  }));

  const tail = rows.slice(limit);
  if (tail.length > 0) {
    const shots = tail.reduce((sum, row) => sum + row.shots, 0);
    drawn.push({
      label: `${tail.length} ${plural(tail.length, "other")}`,
      value: shots,
      valueLabel: `${fmtInt(shots)}  ·  ${fmtPct(known > 0 ? shots / known : 0)}`,
      share: known > 0 ? shots / known : 0,
      muted: true,
    });
  }

  // Listed: every one of them, plus whatever is currently hidden.
  const hidden = field === "cameras" ? stats.hiddenCameras : field === "lenses" ? stats.hiddenLenses : [];
  const dimension = field === "cameras" ? "camera" : field === "lenses" ? "lens" : null;
  const listed = [...rows, ...hidden];

  // One entry is a fact, not a ranking — but it is still worth its slide.
  const noun = field === "cameras" ? "camera" : field === "lenses" ? "lens" : "pairing";
  const headline =
    rows.length === 1
      ? `Everything came from one ${noun}`
      : `${top.label} — ${fmtPct(top.share)} of your frames`;

  const rowsChoice = rowsSetting(field, rows.length, limit, MAX_BARS);

  return {
    kind: "bars",
    id: field,
    title,
    subtitle,
    headline,
    orientation: orientationOf(stats, field, "rows"),
    ...settingsOf(rowsChoice, orientationSetting(stats, field, "rows")),
    items: drawn,
    // The shades need naming wherever any bar has them.
    ...(drawn.some((item) => item.segments)
      ? {
          legend: [
            ...new Set(drawn.flatMap((item) => (item.segments ?? []).map((part) => part.label))),
          ],
        }
      : {}),
    table: {
      columns: [
        title,
        "Photographs",
        ...(listed.some((row) => row.parts) ? ["With a converter"] : []),
        "Share",
        "First",
        "Last",
      ],
      rows: listed.map((row) => [
        row.label,
        row.shots,
        ...(listed.some((entry) => entry.parts)
          ? [
              (row.parts ?? [])
                .filter((part) => part.tc !== null)
                .map((part) => `${part.tc} × ${fmtInt(part.shots)}`)
                .join(", ") || "—",
            ]
          : []),
        row.excluded ? "hidden" : fmtPct(row.share),
        row.firstDay ? formatDay(row.firstDay) : "—",
        row.lastDay ? formatDay(row.lastDay) : "—",
      ]),
      rowKeys: listed.map((row) =>
        dimension === null ? null : { dimension, key: row.key, excluded: row.excluded },
      ),
    },
  };
}

function focalSlide(stats: DeckStats): Slide | null {
  const { focal, focalClasses } = stats;
  if (focal.buckets.length === 0 || focal.favourite === null) return null;

  const favourite = focal.favourite;
  const widest = focal.buckets[0];
  const longest = focal.buckets[focal.buckets.length - 1];
  const topClass = focalClasses[0];

  return {
    kind: "columns",
    id: "focal",
    orientation: orientationOf(stats, "focal", "columns"),
    ...settingsOf(orientationSetting(stats, "focal", "columns")),
    title: "Focal length",
    subtitle: "Where you stood, in millimetres",
    headline: `${favourite.label} is your focal length — ${fmtPct(favourite.shots / focal.known)} of the frames`,
    note: [
      widest && longest ? `${widest.label} to ${longest.label}` : "",
      topClass ? `mostly ${topClass.label}` : "",
    ]
      .filter(Boolean)
      .join(" · ") || undefined,
    items: focal.buckets.map((bucket) => ({ label: bucket.label, value: bucket.shots })),
    highlight: focal.buckets.indexOf(favourite),
    axisLabel: "Focal length",
    table: tableOf(
      ["Focal length", "Photographs"],
      focal.buckets.map((bucket) => [bucket.label, bucket.shots]),
    ),
  };
}

function apertureSlide(stats: DeckStats): Slide | null {
  const { aperture } = stats;
  if (aperture.buckets.length === 0 || aperture.favourite === null) return null;

  const wideOpen = aperture.buckets
    .filter((bucket) => bucket.value <= 2.0)
    .reduce((sum, bucket) => sum + bucket.shots, 0);
  const stoppedDown = aperture.buckets
    .filter((bucket) => bucket.value >= 8)
    .reduce((sum, bucket) => sum + bucket.shots, 0);

  return {
    kind: "columns",
    id: "aperture",
    orientation: orientationOf(stats, "aperture", "columns"),
    ...settingsOf(orientationSetting(stats, "aperture", "columns")),
    title: "Aperture",
    subtitle: "How much you let in",
    headline: `${aperture.favourite.label} more than any other stop`,
    note: `${fmtPct(wideOpen / aperture.known)} at f/2 or wider · ${fmtPct(stoppedDown / aperture.known)} at f/8 or smaller`,
    items: aperture.buckets.map((bucket) => ({ label: bucket.label, value: bucket.shots })),
    highlight: aperture.buckets.indexOf(aperture.favourite),
    axisLabel: "Aperture",
    table: tableOf(
      ["Aperture", "Photographs"],
      aperture.buckets.map((bucket) => [bucket.label, bucket.shots]),
    ),
  };
}

function isoSlide(stats: DeckStats): Slide | null {
  const { iso } = stats;
  if (iso.buckets.length === 0 || iso.favourite === null) return null;

  const high = iso.buckets
    .filter((bucket) => bucket.value >= 3200)
    .reduce((sum, bucket) => sum + bucket.shots, 0);
  const highest = iso.buckets[iso.buckets.length - 1];
  const base = iso.buckets[0];

  return {
    kind: "columns",
    id: "iso",
    orientation: orientationOf(stats, "iso", "columns"),
    ...settingsOf(orientationSetting(stats, "iso", "columns")),
    title: "ISO",
    subtitle: "How dark it got",
    headline: `${iso.favourite.label} is where you live`,
    note: [
      base && highest ? `${base.label} to ${highest.label}` : "",
      `${fmtPct(high / iso.known)} at 3200 or above`,
    ]
      .filter(Boolean)
      .join(" · ") || undefined,
    items: iso.buckets.map((bucket) => ({ label: bucket.label.replace("ISO ", ""), value: bucket.shots })),
    highlight: iso.buckets.indexOf(iso.favourite),
    axisLabel: "ISO",
    table: tableOf(["ISO", "Photographs"], iso.buckets.map((bucket) => [bucket.label, bucket.shots])),
  };
}

function shutterSlide(stats: DeckStats): Slide | null {
  const { shutter } = stats;
  if (shutter.buckets.length === 0 || shutter.favourite === null) return null;

  // Buckets run fast to slow, so the ends are the extremes.
  const fastest = shutter.buckets[0];
  const slowest = shutter.buckets[shutter.buckets.length - 1];
  const long = shutter.buckets
    .filter((bucket) => bucket.value >= 1)
    .reduce((sum, bucket) => sum + bucket.shots, 0);

  return {
    kind: "columns",
    id: "shutter",
    orientation: orientationOf(stats, "shutter", "columns"),
    ...settingsOf(orientationSetting(stats, "shutter", "columns")),
    title: "Shutter speed",
    subtitle: "How still you held it",
    headline: `${shutter.favourite.label} is your default`,
    note: [
      fastest && slowest ? `${fastest.label} to ${slowest.label}` : "",
      long > 0 ? `${fmtPct(long / shutter.known)} at a second or longer` : "",
    ]
      .filter(Boolean)
      .join(" · ") || undefined,
    items: shutter.buckets.map((bucket) => ({ label: bucket.label, value: bucket.shots })),
    highlight: shutter.buckets.indexOf(shutter.favourite),
    axisLabel: "Shutter speed",
    table: tableOf(
      ["Shutter speed", "Photographs"],
      shutter.buckets.map((bucket) => [bucket.label, bucket.shots]),
    ),
  };
}

function clockSlide(stats: DeckStats): Slide | null {
  const total = stats.hours.reduce((sum, n) => sum + n, 0);
  if (total === 0) return null;

  let peak = 0;
  for (let hour = 1; hour < 24; hour++) {
    if ((stats.hours[hour] ?? 0) > (stats.hours[peak] ?? 0)) peak = hour;
  }

  // Counted against the daylight the reader chose, so "after dark" means what
  // the shading means.
  const { sunrise, sunset, source, mode } = stats.daylight;
  const dark = stats.hours.reduce(
    (sum, shots, hour) => (hour + 0.5 < sunrise || hour + 0.5 > sunset ? sum + shots : sum),
    0,
  );

  const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
  const setting: SlideSetting = {
    id: "daylight",
    label: "Daylight is",
    value: mode,
    options: [
      {
        value: "sun",
        label: "Sunrise to sunset",
        note: stats.home
          ? `at ${stats.home.label || "your location"}`
          : stats.location
            ? "from GPS in your frames — set a location in Settings"
            : "set a location in Settings",
      },
      { value: "06-18", label: "06:00 to 18:00" },
      { value: "07-19", label: "07:00 to 19:00" },
      { value: "05-21", label: "05:00 to 21:00" },
      {
        value: "custom",
        label: "Hours I choose",
        note: `${clock(stats.daylightHours.sunrise)} to ${clock(stats.daylightHours.sunset)}`,
      },
    ],
    // Only meaningful under the last option, so it is only shown there.
    hours: {
      shownWhen: "custom",
      fromId: "dayFrom",
      from: stats.daylightHours.sunrise,
      toId: "dayTo",
      to: stats.daylightHours.sunset,
    },
  };

  return {
    kind: "clock",
    id: "clock",
    title: "Time of day",
    subtitle: "When the shutter goes",
    headline: `${hourLabel(peak)} is your hour — ${fmtPct((stats.hours[peak] ?? 0) / total)} of everything`,
    note: `${fmtPct(dark / total)} after dark · daylight ${source}`,
    settings: [setting],
    hours: stats.hours,
    sunrise,
    sunset,
    table: tableOf(
      ["Hour", "Photographs"],
      stats.hours.map((shots, hour) => [hourLabel(hour), shots]),
    ),
  };
}

/** "You were out on 383 days, 14% of the period" — never "383 of 2,798". */
function daysOutNote(stats: DeckStats): string {
  const out = stats.totals.daysShot;
  const across = stats.totals.daysInRange;
  return `You were out on ${fmtInt(out)} days, ${fmtPct(across > 0 ? out / across : 0)} of the period`;
}

/** `06:30` — an hour as a clock reads it. */
function clock(hour: number): string {
  const whole = Math.floor(hour);
  const minutes = Math.round((hour - whole) * 60);
  return `${String(whole % 24).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** How far to rotate a Monday-first week so it starts where the reader does. */
const WEEK_OFFSET: Record<WeekStart, number> = { mon: 0, sun: 6, sat: 5 };

function weekSlide(stats: DeckStats): Slide | null {
  const total = stats.weekdays.reduce((sum, n) => sum + n, 0);
  if (total === 0) return null;

  let busiest = 0;
  for (let day = 1; day < 7; day++) {
    if ((stats.weekdays[day] ?? 0) > (stats.weekdays[busiest] ?? 0)) busiest = day;
  }
  const weekend = (stats.weekdays[5] ?? 0) + (stats.weekdays[6] ?? 0);

  // Rotated here rather than in the renderer: the slide decides what its own
  // week looks like, and the table has to agree with the chart.
  const offset = WEEK_OFFSET[stats.weekStart];
  const order = Array.from({ length: 7 }, (_, i) => (i + offset) % 7);

  const settings: SlideSetting[] = [
    {
      id: "weekStart",
      label: "The week starts on",
      value: stats.weekStart,
      options: [
        { value: "mon", label: "Monday" },
        { value: "sun", label: "Sunday" },
        { value: "sat", label: "Saturday" },
      ],
    },
    {
      id: "weekend",
      label: "The weekend",
      value: stats.markWeekend ? "mark" : "plain",
      options: [
        { value: "plain", label: "Same as the rest" },
        { value: "mark", label: "In its own colour", note: "Saturday and Sunday" },
      ],
    },
    orientationSetting(stats, "week", "columns"),
  ];

  return {
    kind: "week",
    id: "week",
    orientation: orientationOf(stats, "week", "columns"),
    title: "Day of the week",
    subtitle: "The shape of your week",
    headline: `${DAY_NAMES[busiest]} is your day`,
    note: `${fmtPct(weekend / total)} at the weekend`,
    settings,
    days: order.map((day) => stats.weekdays[day] ?? 0),
    labels: order.map((day) => DAY_NAMES[day] ?? ""),
    // Positions in the rotated week that are Saturday or Sunday, when they are
    // to be drawn as their own thing.
    weekend: stats.markWeekend ? order.flatMap((day, i) => (day >= 5 ? [i] : [])) : [],
    table: tableOf(
      ["Day", "Photographs"],
      order.map((day) => [WEEKDAYS[day] ?? "", stats.weekdays[day] ?? 0]),
    ),
  };
}

function calendarSlide(stats: DeckStats): Slide | null {
  const { busiestDay, range } = stats;
  if (!busiestDay) return null;

  const headline = `${formatDay(busiestDay.day)} — ${shotsPhrase(busiestDay.shots)} in one day`;

  // A calendar is only legible up to about a year; past that the months carry
  // the shape and the day-by-day view moves to the streaks slide.
  if (stats.daily.length > 0 && range.days <= HEATMAP_MAX_DAYS) {
    return {
      kind: "calendar",
      id: "calendar",
      title: "Every day",
      subtitle: "One square per day",
      headline,
      note: daysOutNote(stats),
      days: stats.daily,
      from: range.from,
      to: range.to,
      table: tableOf(
        ["Day", "Photographs"],
        stats.daily.map((entry) => [formatDay(entry.day), entry.shots]),
      ),
    };
  }

  // Too long a range for a legible calendar — the months carry the shape.
  return {
    kind: "months",
    id: "calendar",
    title: "Month by month",
    subtitle: "The long view",
    orientation: orientationOf(stats, "calendar", "rows"),
    marks: marksFor(stats, "months"),
    ...settingsOf(
      marksSetting(stats, "months"),
      ...typeSettings(stats, "months"),
      orientationSetting(stats, "calendar", "rows"),
    ),
    headline,
    note: daysOutNote(stats),
    months: stats.monthly,
    table: tableOf(
      ["Month", "Photographs"],
      stats.monthly.map((entry) => [formatYearMonth(entry.ym), entry.shots]),
    ),
  };
}

/**
 * Runs and quiet spells, which used to be two sentences under the calendar.
 *
 * They are the answer to a question the calendar does not ask — how *steadily*
 * do you shoot — and a shape rather than a number: a line of days, each one
 * marked or not, with the longest run and the longest silence picked out of it.
 */
/** Fewer days than this at either end of the range is not a year, it is an offcut. */
const SLIVER_DAYS = 28;

/**
 * Folds a clipped end period into its neighbour.
 *
 * Every row of the wall is the same height whatever it holds, so a period the
 * range only clips a sliver of costs a full row to say a fortnight — and takes
 * that height off the years either side of it. Unbounded ranges end today, so
 * this is not hypothetical: for the week after a start-date anniversary, "all
 * time" reaches two days into a period that has barely begun.
 *
 * No day is dropped. The neighbouring row runs past its own boundary to cover
 * them, which is what "every day in the range" requires — its label is then a
 * few days out at one end, which nobody can see and everybody can live with.
 * Only a *clipped* period is ever folded: a whole year with nothing in it has
 * earned its row, and saying so is the point of drawing one.
 */
function foldSlivers<T extends { from: number; to: number }>(spans: T[]): T[] {
  const sliver = (span: T) => daysBetween(span.from, span.to) + 1 < SLIVER_DAYS;
  let kept = spans;

  if (kept.length > 1) {
    const last = kept[kept.length - 1] as T;
    const before = kept[kept.length - 2] as T;
    if (sliver(last)) kept = [...kept.slice(0, -2), { ...before, to: last.to }];
  }

  if (kept.length > 1) {
    const first = kept[0] as T;
    const after = kept[1] as T;
    if (sliver(first)) kept = [{ ...after, from: first.from }, ...kept.slice(2)];
  }

  return kept;
}

function streaksSlide(stats: DeckStats): Slide | null {
  const { longestStreak, longestGap, range, daily } = stats;
  if (daily.length === 0) return null;
  if (!longestStreak && !longestGap) return null;

  const run = longestStreak?.days ?? 0;
  const quiet = longestGap?.days ?? 0;
  // Nothing to say about a fortnight where both are a day or two.
  if (run < 2 && quiet < 3) return null;

  const headline =
    run >= quiet
      ? `${run} days in a row`
      : `${fmtInt(quiet)} days without picking it up`;

  const months = monthsBetween(range.from, range.to);

  // The years the range covers, on whichever kind of year the reader is
  // thinking in. They are labels along a packed wall, or rows of their own.
  // With less than two there is nothing to choose between, so neither the basis
  // nor the layout is offered.
  const years = foldSlivers(
    stats.years
      .filter((year) => year.to >= range.from && year.from <= range.to)
      .map((year) => ({
        label: year.label,
        from: Math.max(year.from, range.from),
        to: Math.min(year.to, range.to),
      })),
  );

  /**
   * The shape asked for, or the nearest one this range can hold: a row per year
   * needs more than one year and a block per month more than one month, and a
   * setting saved against a wider range should not leave a narrow one empty.
   */
  const layout: WallLayout =
    stats.wall === "years" && years.length > 1
      ? "years"
      : stats.wall === "months" && months > 1
        ? "months"
        : "packed";

  return {
    kind: "strip",
    id: "streaks",
    title: "Streaks",
    subtitle: "Every day in the range, shot or not",
    marks: marksFor(stats, "streaks"),
    headline,
    // "330 of 1,090 days" said nothing about which number was which.
    note: daysOutNote(stats),
    ...settingsOf(
      // A row per year needs more than one year to line up, but a block per
      // month needs only more than one month — so the setting is offered to
      // ranges the year option alone would have left without one.
      years.length > 1 || months > 1
        ? {
            id: "wall",
            label: "Lay the days out",
            value: layout,
            options: [
              { value: "packed", label: "As one wall", note: "as large as the slide allows" },
              ...(years.length > 1 ? [{ value: "years", label: "A row per year" }] : []),
              ...(months > 1
                ? [{ value: "months", label: "A block per month", note: "days on their weekdays" }]
                : []),
            ],
          }
        : null,
      years.length > 1 ? yearBasisSetting(stats) : null,
      marksSetting(stats, "streaks"),
      ...typeSettings(stats, "streaks"),
    ),
    days: daily,
    from: range.from,
    to: range.to,
    streak: longestStreak,
    gap: longestGap,
    years,
    layout,
    table: tableOf(
      ["Measure", "Days", "From", "To"],
      [
        [
          "Longest run",
          longestStreak?.days ?? 0,
          longestStreak ? formatDay(longestStreak.from) : "—",
          longestStreak ? formatDay(longestStreak.to) : "—",
        ],
        [
          "Longest quiet spell",
          longestGap?.days ?? 0,
          longestGap ? formatDay(longestGap.from) : "—",
          longestGap ? formatDay(longestGap.to) : "—",
        ],
        ["Days out", stats.totals.daysShot, formatDay(range.from), formatDay(range.to)],
      ],
    ),
  };
}

function timelineSlide(stats: DeckStats): Slide | null {
  const { timeline } = stats;
  if (timeline.months.length < 3 || timeline.series.length < 2) return null;

  // Which lens led in the last month with any frames at all.
  const lastIndex = timeline.months.length - 1;
  let leader: Series | null = null;
  for (const series of timeline.series) {
    if (leader === null || (series.values[lastIndex] ?? 0) > (leader.values[lastIndex] ?? 0)) {
      leader = series;
    }
  }

  const pooled = timeline.series.some((series) => series.label === "Everything else");
  const named = timeline.series.length - (pooled ? 1 : 0);

  // Past the palette's eight slots the colours are generated, so the ceiling
  // here is what a legend can still name rather than what the palette holds.
  const rowsChoice = rowsSetting(
    "gear",
    pooled ? stats.lenses.length : named,
    stats.limits.gear,
    MAX_SERIES,
  );

  return {
    kind: "stack",
    id: "timeline",
    title: "Gear over time",
    subtitle: "What was on the camera, month by month",
    marks: marksFor(stats, "timeline"),
    headline:
      leader && (leader.values[lastIndex] ?? 0) > 0
        ? `${leader.label} closed out ${formatYearMonth(timeline.months[lastIndex] as number)}`
        : "How your kit rotated",
    note: pooled ? `Your ${named} most-used lenses, the rest pooled` : "Every lens you used",
    ...settingsOf(rowsChoice, marksSetting(stats, "timeline"), ...typeSettings(stats, "timeline")),
    months: timeline.months,
    series: timeline.series,
    table: tableOf(
      ["Month", ...timeline.series.map((series) => series.label)],
      timeline.months.map((ym, index) => [
        formatYearMonth(ym),
        ...timeline.series.map((series) => series.values[index] ?? 0),
      ]),
    ),
  };
}

/**
 * Culling: what you said yes to, what you said no to, and what you never went
 * back to at all.
 *
 * Separate from the keepers slide, which is about stars. A flag is a decision
 * made at the culling stage — a pick is "this one", a reject is "not this one"
 * — and the number most photographers cannot guess is the third one.
 *
 * The deletions figure is honest about its own age: nothing in a catalog says
 * what used to be in it, so what has vanished *since* this tool first looked is
 * counted, the note says when that was, and everything from before it is a
 * number only the reader can supply.
 */
function cullingSlide(stats: DeckStats): Slide | null {
  const { picked, rejected, unflagged, removed, removedRejected, watchingSince } = stats.culling;
  const { deletedBefore } = stats.culling;

  /**
   * Rejects, including the ones there is nothing left of.
   *
   * A photograph that was taken and then permanently deleted is a decision, and
   * it is not "keep" — so the reader's own count of what they threw out before
   * indexing belongs in this bucket rather than in a footnote beside it. It is
   * the only bucket it can honestly join: those frames have no rating, no flag
   * and no file, and `computeStats` has already refused to hand one over to
   * any deck narrower than all time.
   */
  const rejects = rejected + deletedBefore;
  const decided = picked + rejects;
  // A library where nothing has ever been decided has nothing to say here.
  if (decided === 0) return null;

  const total = picked + rejects + unflagged;
  const share = (n: number) => (total > 0 ? n / total : 0);

  // The ratio rather than either share: both shares are on the cards below, and
  // no number should appear twice on one slide. It is also the way the decision
  // is actually described out loud — "I keep about one in three".
  const ratio = Math.max(picked, rejects) / Math.max(1, Math.min(picked, rejects));
  const headline =
    rejects === 0
      ? "Every flag you have set is a keeper"
      : picked === 0
        ? // A folder library carries no flags at all, so somebody who fills the
          // deletions figure in can reach this slide having never flagged
          // anything — and "the only flag you use" would then name a flag they
          // have never set.
          rejected === 0
          ? "Everything you have decided about, you deleted"
          : "The only flag you use is reject"
        : ratio < 1.15
          ? "You keep about as many as you throw out"
          : picked > rejects
            ? `You keep ${ratio.toFixed(1)} frames for every one you throw out`
            : `You throw out ${ratio.toFixed(1)} frames for every one you keep`;

  /**
   * One line, and the deletions from before indexing get it when there are any.
   *
   * The reject card is then showing frames that are not in the library, and a
   * number on screen that needs explaining beats a number that is merely worth
   * knowing. What has left *since* the first sweep is in the table either way,
   * which is where a denominator belongs.
   */
  const note =
    deletedBefore > 0
      ? "Rejects include the ones you had already deleted"
      : removed > 0 && watchingSince
        ? `${fmtInt(removed)} gone from the library since ${formatDay(dayOf(watchingSince))}${
            removedRejected > 0 ? `, ${fmtInt(removedRejected)} of them rejects` : ""
          }`
        : undefined;

  return {
    kind: "verdict",
    id: "culling",
    title: "Culling",
    subtitle: "Picks, rejects, and the ones you never went back to",
    headline,
    ...(note ? { note } : {}),
    cards: [
      {
        glyph: { kind: "thumb", up: true },
        label: "Picked",
        value: fmtInt(picked),
        note: `${fmtPct(share(picked))} of your frames`,
      },
      {
        glyph: { kind: "thumb", up: false },
        label: "Rejected",
        value: fmtInt(rejects),
        note: `${fmtPct(share(rejects))} of your frames`,
      },
    ],
    rest: {
      label: "Never flagged either way",
      value: fmtInt(unflagged),
      note: `${fmtPct(share(unflagged))} of your frames`,
    },
    table: tableOf(
      ["Flag", "Photographs", "Share"],
      [
        ["Picked", picked, fmtPct(share(picked))],
        ["Rejected", rejects, fmtPct(share(rejects))],
        ["Neither", unflagged, fmtPct(share(unflagged))],
        // Two deletion rows, and they say opposite things about the count above
        // them on purpose: one is inside it, the other never can be.
        ...(deletedBefore > 0
          ? [["Deleted before indexing", deletedBefore, "counted as rejects above"]]
          : []),
        ["Deleted since indexing", removed, removed > 0 ? "not in any count above" : "—"],
      ],
    ),
  };
}

/** A timestamp as a day, for saying when this tool started watching. */
function dayOf(at: number): number {
  const date = new Date(at);
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

/**
 * The ratings, as five cards with the stars drawn on them.
 *
 * A rating is a verdict, not a measurement — the same argument that turned
 * culling into cards. Nobody measures four stars against an axis; they look at
 * how many there were. And the one slide in the deck about a thing with a
 * universally understood symbol should not be drawing typewriter asterisks.
 *
 * Every rating gets a card, including the ones nobody used: a gap in a scale is
 * information, and a missing card would quietly close it up.
 */
function keepersSlide(stats: DeckStats): Slide | null {
  const rated = stats.ratings.reduce((sum, n, stars) => (stars > 0 ? sum + n : sum), 0);
  if (rated === 0) return null;

  // Everything that was never given a star. It dwarfs the rated frames in most
  // libraries, which is why it is the card underneath rather than a sixth card
  // that would make the other five unreadable.
  const unrated = Math.max(0, stats.totals.shots - rated);
  const ofRated = (n: number) => (rated > 0 ? n / rated : 0);

  /**
   * How selective the rating is, which is the one thing no card says.
   *
   * The headline used to be the four-plus count, and the four- and five-star
   * cards now carry those numbers themselves — so it had to become something
   * else rather than the same number in larger type.
   */
  const everyN = rated > 0 ? stats.totals.shots / rated : 0;
  const headline =
    everyN < 1.2
      ? "You rate almost everything you shoot"
      : `You rate about one frame in ${fmtInt(everyN)}`;

  const fourPlus = (stats.ratings[4] ?? 0) + (stats.ratings[5] ?? 0);

  return {
    kind: "verdict",
    id: "keepers",
    title: "Keepers",
    subtitle: "What survived the edit",
    headline,
    note: `${fmtPct(ofRated(fourPlus))} of what you rated is four stars or better · ratings come from Lightroom`,
    cards: [1, 2, 3, 4, 5].map((stars) => ({
      glyph: { kind: "stars" as const, count: stars },
      // The word as well as the glyph. Four small stars and five small stars
      // are genuinely hard to tell apart, and this is also the name the hover
      // and the table use.
      label: `${stars} star${stars === 1 ? "" : "s"}`,
      value: fmtInt(stats.ratings[stars] ?? 0),
      note: `${fmtPct(ofRated(stats.ratings[stars] ?? 0))} of rated`,
    })),
    rest: {
      label: "Never rated",
      value: fmtInt(unrated),
      // A different denominator from the cards above, and it says so: the cards
      // divide by what was rated, and this one cannot.
      note: `${fmtPct(unrated / Math.max(1, stats.totals.shots))} of everything you shot`,
    },
    table: tableOf(
      ["Rating", "Photographs", "Share of rated"],
      [
        ...[1, 2, 3, 4, 5].map((stars): Array<string | number> => [
          `${stars} star${stars === 1 ? "" : "s"}`,
          stats.ratings[stars] ?? 0,
          fmtPct(ofRated(stats.ratings[stars] ?? 0)),
        ]),
        ["Never rated", unrated, "—"],
      ],
    ),
  };
}

function shapeSlide(stats: DeckStats): Slide | null {
  const { totals, orientation } = stats;
  const oriented = orientation.landscape + orientation.portrait + orientation.square;
  const tiles: Tile[] = [];

  if (oriented > 0) {
    tiles.push({
      label: "Landscape",
      value: fmtPct(orientation.landscape / oriented),
      note: `${fmtInt(orientation.landscape)} frames`,
    });
    tiles.push({
      label: "Portrait",
      value: fmtPct(orientation.portrait / oriented),
      note: `${fmtInt(orientation.portrait)} frames`,
    });
  }
  if (totals.raws + totals.jpegs > 0) {
    tiles.push({
      label: "Shot raw",
      value: fmtPct(totals.raws / (totals.raws + totals.jpegs)),
      note: `${fmtInt(totals.raws)} raw files`,
    });
  }
  if (totals.withFlash > 0) {
    tiles.push({
      label: "Flash fired",
      value: fmtPct(totals.withFlash / totals.shots),
      note: `${fmtInt(totals.withFlash)} frames`,
    });
  }
  if (totals.videos > 0) {
    tiles.push({
      label: "Video",
      value: fmtInt(totals.videos),
      note: totals.videoSeconds > 0 ? `${fmtDuration(totals.videoSeconds)} of footage` : undefined,
    });
  }
  if (totals.bodies > 1) {
    tiles.push({ label: "Bodies", value: fmtInt(totals.bodies), note: "distinct serial numbers" });
  }

  if (tiles.length < 2) return null;

  const headline =
    oriented > 0 && orientation.portrait > orientation.landscape
      ? "You turn the camera on its side more often than not"
      : oriented > 0
        ? `${fmtPct(orientation.landscape / oriented)} of your frames are horizontal`
        : "The shape of the work";

  return {
    kind: "tiles",
    id: "shape",
    title: "The shape of it",
    subtitle: "Format, orientation, and what else was going on",
    headline,
    tiles,
    table: tableOf(
      ["Measure", "Value"],
      [
        ["Landscape", orientation.landscape],
        ["Portrait", orientation.portrait],
        ["Square", orientation.square],
        ["Raw files", totals.raws],
        ["JPEG and other stills", totals.jpegs],
        ["Clips", totals.videos],
        ["Flash fired", totals.withFlash],
      ],
    ),
  };
}

function placesSlide(stats: DeckStats): Slide | null {
  if (stats.places.length === 0) return null;

  const north = stats.places.reduce((best, place) => (place.lat > best.lat ? place : best));
  const south = stats.places.reduce((best, place) => (place.lat < best.lat ? place : best));
  const spread = north.lat - south.lat;

  const busiest = stats.places.reduce((best, place) => (place.shots > best.shots ? place : best));

  const coord = (place: Place) =>
    `${Math.abs(place.lat).toFixed(1)}°${place.lat >= 0 ? "N" : "S"}, ${Math.abs(place.lon).toFixed(1)}°${place.lon >= 0 ? "E" : "W"}`;

  return {
    kind: "map",
    id: "places",
    title: "Where",
    subtitle: "Every frame that knew where it was",
    headline:
      spread > 5
        ? `${spread.toFixed(0)}° of latitude, from ${coord(south)} to ${coord(north)}`
        : `Most of it around ${coord(busiest)}`,
    note: "Rounded to ~11km",
    points: stats.places,
    table: tableOf(
      ["Position", "Photographs"],
      [...stats.places]
        .sort((a, b) => b.shots - a.shots)
        // Every cluster, so the table is the whole picture; the map draws them
        // all anyway, and a library with thousands of them has earned the rows.
        .map((place) => [coord(place), place.shots]),
    ),
  };
}

/**
 * What the milestones add up to.
 *
 * Every date here was entered by the reader rather than inferred from a first
 * frame, which is exactly why this slide can answer things the rest of the deck
 * cannot: "the first lens you bought" is not a question a photograph can answer,
 * and neither is "how long you went without buying anything".
 *
 * Nothing about money. This tool does not know what anything cost and has no
 * business asking.
 */
function kitSlide(stats: DeckStats): Slide | null {
  const gear = stats.milestones.filter((m) => m.gear !== null);
  // One purchase is a fact. Two is a history.
  if (gear.length < 2) return null;

  const bought = gear.filter((m) => m.kind === "bought");
  const sold = gear.filter((m) => m.kind === "sold");
  const isGlass = (m: Milestone) => m.gear?.dimension !== "camera";
  const sameThing = (a: Milestone, b: Milestone) =>
    a.gear?.dimension === b.gear?.dimension && a.gear?.key === b.gear?.key;

  const items: Array<{ label: string; meta: string; value: string }> = [];
  const rows: Array<Array<string | number>> = [];

  const add = (fact: string, thing: string, when: string, value: string, extra = "") => {
    items.push({
      label: thing,
      meta: `${fact} · ${when}${extra === "" ? "" : ` · ${extra}`}`,
      value,
    });
    rows.push([fact, thing, when, value]);
  };

  const frames = (m: Milestone) =>
    `${fmtInt(m.gear?.shots ?? 0)} ${plural(m.gear?.shots ?? 0, "frame")}`;

  const firstSale = sold[0];

  /**
   * Whether this is also the first thing that left.
   *
   * Only when the purchase came first. Something sold before the earliest
   * purchase on record is a different ownership wearing the same name — you
   * bought it again — and one row reading "2025 to 2024" is worse than two
   * honest ones.
   */
  const alsoFirstSold = (m: Milestone) =>
    firstSale !== undefined && sameThing(m, firstSale) && firstSale.day >= m.day;

  /**
   * The first thing you bought, said once.
   *
   * When it is also the first thing you sold, two rows would carry the same
   * name, the same frame count and two halves of one story. They become a
   * single row running from the purchase to the sale, and the sale row below
   * steps aside.
   */
  const firstPurchase = (fact: string, m: Milestone) => {
    if (firstSale === undefined || !stats.kit.combine || !alsoFirstSold(m)) {
      add(fact, m.gear?.label ?? "", formatDay(m.day), frames(m));
      return;
    }

    // How long you had it, rather than how long you shot it: the dates either
    // side already say when, and the sale row's "of shooting" would be the same
    // span twice on one line.
    add(
      `${fact}, and the first you sold`,
      m.gear?.label ?? "",
      `${formatDay(m.day)} to ${formatDay(firstSale.day)}`,
      frames(m),
      fmtSpan(daysBetween(m.day, firstSale.day)),
    );
  };

  const firstBody = bought.find((m) => m.gear?.dimension === "camera");
  if (firstBody) firstPurchase("First body you bought", firstBody);

  // The second body is the first upgrade, whether or not the first one left:
  // buying another camera is the moment, and what happened to the old one is a
  // separate fact the sale row already carries.
  const bodies = bought.filter((m) => m.gear?.dimension === "camera");
  const upgrade = bodies[1];
  if (firstBody && upgrade) {
    add(
      "First body upgrade",
      `${firstBody.gear?.label ?? "?"} → ${upgrade.gear?.label ?? "?"}`,
      `${formatDay(firstBody.day)} to ${formatDay(upgrade.day)}`,
      fmtSpan(daysBetween(firstBody.day, upgrade.day)),
    );
  }

  const firstGlass = bought.find(isGlass);
  if (firstGlass) firstPurchase("First lens you bought", firstGlass);

  // Whether the first thing to leave is the first thing that arrived, asked of
  // the milestones and not of the setting — see `combineSetting`.
  const repeats =
    (firstBody !== undefined && alsoFirstSold(firstBody)) ||
    (firstGlass !== undefined && alsoFirstSold(firstGlass));
  // Already said above, in that case.
  const merged = repeats && stats.kit.combine;

  if (firstSale && !merged) {
    // What it did while you had it — which is the only interesting thing about
    // a sale, and the one number a sale slide can honestly give.
    const owned = firstSale.gear?.firstDay
      ? fmtSpan(daysBetween(firstSale.gear.firstDay, firstSale.day))
      : "";
    add(
      "First thing you sold",
      firstSale.gear?.label ?? "",
      formatDay(firstSale.day),
      frames(firstSale),
      owned === "" ? "" : `${owned} of shooting`,
    );
  }

  /**
   * What was owned and then let go, and for how long.
   *
   * A sale is paired with the most recent purchase of the same thing before it,
   * which is what makes a lens bought, sold and bought again read correctly
   * rather than as one twelve-year ownership.
   */
  const owned = sold
    .map((sale) => {
      const bought_ = bought.filter((buy) => sameThing(buy, sale) && buy.day <= sale.day).at(-1);
      return bought_ ? { sale, from: bought_.day, days: daysBetween(bought_.day, sale.day) } : null;
    })
    .filter((held): held is { sale: Milestone; from: number; days: number } => held !== null);

  const briefest =
    owned.length > 0 ? owned.reduce((best, held) => (held.days < best.days ? held : best)) : null;

  /**
   * Whether a row above has already told this ownership.
   *
   * With one sale it is the sale row wearing a different hat, which is the
   * guard this row was born with. And once bought-first and sold-first are a
   * single row, that row carries the purchase, the sale and the span between
   * them — so if the shortest is that same sale, this is the line above,
   * repeated with a new heading.
   */
  const alreadyAbove = owned.length === 1 || (merged && briefest?.sale === firstSale);
  const shortest = briefest !== null && !alreadyAbove ? briefest : null;

  if (shortest !== null && stats.kit.ownership) {
    add(
      "Shortest you kept anything",
      shortest.sale.gear?.label ?? "",
      `${formatDay(shortest.from)} to ${formatDay(shortest.sale.day)}`,
      fmtSpan(shortest.days),
    );
  }

  // Still yours: bought, and never sold afterwards. Measured to the end of the
  // range rather than to today, because that is what this deck is about.
  const soldAfter = (m: Milestone) =>
    sold.some((s) => s.gear?.key === m.gear?.key && s.gear?.dimension === m.gear?.dimension && s.day >= m.day);
  const kept = bought.filter((m) => !soldAfter(m));
  const longestHeld = kept[0];
  if (longestHeld) {
    add(
      "Owned longest",
      longestHeld.gear?.label ?? "",
      `yours since ${formatDay(longestHeld.day)}`,
      fmtSpan(daysBetween(longestHeld.day, stats.range.to)),
    );
  }

  // The gaps between one purchase and the next. Two purchases make one gap,
  // which is a fact about a pair rather than a habit, so it takes three.
  if (bought.length >= 3) {
    const gaps = bought.slice(1).map((m, i) => ({
      from: bought[i] as Milestone,
      to: m,
      days: daysBetween((bought[i] as Milestone).day, m.day),
    }));
    const longest = gaps.reduce((best, gap) => (gap.days > best.days ? gap : best));
    const shortest = gaps.reduce((best, gap) => (gap.days < best.days ? gap : best));

    const pair = (gap: (typeof gaps)[number]) =>
      `${gap.from.gear?.label ?? "?"} → ${gap.to.gear?.label ?? "?"}`;

    const span = (gap: (typeof gaps)[number]) => `${formatDay(gap.from.day)} to ${formatDay(gap.to.day)}`;

    add("Longest you went without buying anything", pair(longest), span(longest), fmtSpan(longest.days));
    if (shortest !== longest) {
      add("Shortest between two purchases", pair(shortest), span(shortest), fmtSpan(shortest.days));
    }
  }

  if (items.length === 0) return null;

  const headline = `${fmtInt(bought.length)} ${plural(bought.length, "purchase")}${
    sold.length > 0 ? ` and ${fmtInt(sold.length)} ${plural(sold.length, "sale")}` : ""
  }, in your own words`;

  return {
    kind: "list",
    id: "kit",
    title: "Kit history",
    subtitle: "Dated by you, not guessed from a first frame",
    headline,
    items,
    table: tableOf(["Fact", "Gear", "When", "Measure"], rows),
    ...settingsOf(repeats ? combineSetting(stats) : null, shortest !== null ? ownershipSetting(stats) : null),
  };
}

function debutsSlide(stats: DeckStats): Slide | null {
  if (stats.debuts.length === 0) return null;
  if (stats.range.spec.kind === "all" && stats.debuts.length > 12) return null;

  const first = stats.debuts[0];
  if (!first) return null;

  // A milestone beats a first frame, and the row says which it used. One is a
  // date the reader knows; the other is this tool guessing from a photograph,
  // and the two are not the same kind of claim.
  const bought = new Map(
    stats.milestones
      .filter((m) => m.kind === "bought" && m.gear !== null)
      .map((m) => [`${m.gear?.dimension}:${m.gear?.key}`, m.day] as const),
  );
  const purchase = (debut: Debut) => bought.get(`${debut.kind}:${debut.key}`) ?? null;
  const told = stats.debuts.filter((debut) => purchase(debut) !== null).length;

  return {
    kind: "list",
    id: "debuts",
    title: "New in the bag",
    subtitle: "First frames on gear you had not used before",
    headline: `${stats.debuts.length} ${plural(stats.debuts.length, "new piece", "new pieces")} of kit`,
    note:
      told === stats.debuts.length
        ? "Dated by the milestones you saved"
        : told > 0
          ? "Dated by your milestones where you have one, and by a first frame otherwise"
          : "Dated by its first frame anywhere in your library",
    items: stats.debuts.map((debut) => {
      const day = purchase(debut);
      return {
        label: debut.label,
        meta: `${debut.kind === "camera" ? "Camera" : "Lens"} · ${
          day === null ? `first frame ${formatDay(debut.day)}` : `bought ${formatDay(day)}`
        }`,
        value: `${fmtInt(debut.shots)} ${plural(debut.shots, "frame")} since`,
      };
    }),
    table: tableOf(
      ["Gear", "Kind", "When", "Dated by", "Frames since"],
      stats.debuts.map((debut) => {
        const day = purchase(debut);
        return [
          debut.label,
          debut.kind,
          formatDay(day ?? debut.day),
          day === null ? "first frame" : "a milestone",
          debut.shots,
        ];
      }),
    ),
  };
}

function burstSlide(stats: DeckStats): Slide | null {
  const { burst } = stats;
  if (!burst || burst.frames < 8) return null;

  const rate = burst.seconds > 0 ? burst.frames / burst.seconds : burst.frames;

  // Every number appears once. The hero is the frame count, so the headline
  // says it in words and the tiles carry the numbers it does not.
  return {
    kind: "hero",
    id: "burst",
    title: "The longest burst",
    headline: "The longest you held the shutter down",
    value: fmtInt(burst.frames),
    caption: `frames in ${burst.seconds <= 1 ? "under a second" : `${fmtInt(burst.seconds)} seconds`}`,
    subtitle: burst.camera ?? undefined,
    note: "Frames no more than two seconds apart",
    tiles: [
      { label: "When", value: formatDay(burst.day) },
      { label: "Rate", value: `${rate.toFixed(1)}/s`, note: "frames a second" },
    ],
    table: tableOf(
      ["Measure", "Value"],
      [
        ["Frames", burst.frames],
        ["Seconds", burst.seconds],
        ["Day", formatDay(burst.day)],
        ["Camera", burst.camera ?? "—"],
      ],
    ),
  };
}

function closing(stats: DeckStats): Slide {
  const { totals } = stats;
  const topCamera = stats.cameras[0];
  const topLens = stats.lenses[0];
  const topCombo = stats.combos[0];

  const tiles: Tile[] = [
    { label: "Photographs", value: fmtInt(taken(totals)) },
    { label: "Days out", value: fmtInt(totals.daysShot) },
  ];
  if (topCamera) tiles.push({ label: "Camera of the period", value: topCamera.label, note: `${fmtInt(topCamera.shots)} frames` });
  if (topLens) tiles.push({ label: "Lens of the period", value: topLens.label, note: `${fmtInt(topLens.shots)} frames` });
  if (stats.focal.favourite) tiles.push({ label: "Favourite focal length", value: stats.focal.favourite.label });
  if (stats.aperture.favourite) tiles.push({ label: "Favourite aperture", value: stats.aperture.favourite.label });

  return {
    kind: "tiles",
    id: "closing",
    title: "In short",
    subtitle: stats.range.label,
    headline: topCombo
      ? `${topCombo.label} — ${fmtPct(topCombo.share)} of everything`
      : shotsPhrase(taken(totals)),
    tiles,
    table: tableOf(
      ["Measure", "Value"],
      [
        ["Photographs", taken(totals)],
        ["Days out", totals.daysShot],
        ["Camera", topCamera?.label ?? "—"],
        ["Lens", topLens?.label ?? "—"],
        ["Pairing", topCombo?.label ?? "—"],
        ["Focal length", stats.focal.favourite?.label ?? "—"],
        ["Aperture", stats.aperture.favourite?.label ?? "—"],
      ],
    ),
  };
}
