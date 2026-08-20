import { HEATMAP_MAX_DAYS, MAX_ROWS as MAX_BARS, MAX_SERIES } from "./aggregate.ts";
import type {
  DeckStats,
  DayCount,
  Place,
  Series,
  Streak,
  WeekStart,
  YearBucket,
} from "./aggregate.ts";
import { formatDay, formatYearMonth, WEEKDAYS } from "../core/time.ts";

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

interface Common {
  id: string;
  title: string;
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
      /** An answer the columns cannot give, set beside them in full size. */
      figure?: { value: string; label: string };
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
      /** "packed" fills the slide; "years" gives each year its own row. */
      layout: "packed" | "years";
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
       * The two decisions, side by side, each with the gesture that made it.
       *
       * A verdict is not a category and not a magnitude — it is a judgement,
       * and two of them read faster as two cards than as two columns of a bar
       * chart nobody needs to measure against an axis.
       */
      cards: Array<{ verdict: "up" | "down"; label: string; value: string; note: string }>;
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

/** `2,481 photographs` — the phrase that appears in half the headlines. */
const shotsPhrase = (n: number): string => `${fmtInt(n)} ${plural(n, "photograph")}`;

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

  let subtitle = `${formatDay(totals.firstDay ?? range.from)} — ${formatDay(totals.lastDay ?? range.to)}`;
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
    headline: shotsPhrase(totals.shots),
    value: fmtInt(totals.shots),
    caption: totals.videos > 0
      ? `photographs and ${fmtInt(totals.videos)} ${plural(totals.videos, "clip")}`
      : plural(totals.shots, "photograph"),
    subtitle,
    tiles,
    // Footnotes are a phrase, never a paragraph, and never a count of frames —
    // the numbers are the slide, and every denominator is in the table view.
    note: range.clipped ? `From ${formatDay(range.from)}` : undefined,
    table: tableOf(
      ["Measure", "Value"],
      [
        ["Photographs", totals.shots],
        ["Files", totals.files],
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
    ...(rowsChoice ? { settings: [rowsChoice] } : {}),
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
  ];

  return {
    kind: "week",
    id: "week",
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

  // The years the range covers, on whichever kind of year the reader is
  // thinking in. They are labels along a packed wall, or rows of their own.
  // With less than two there is nothing to choose between, so neither the basis
  // nor the layout is offered.
  const years = stats.years
    .filter((year) => year.to >= range.from && year.from <= range.to)
    .map((year) => ({
      label: year.label,
      from: Math.max(year.from, range.from),
      to: Math.min(year.to, range.to),
    }));

  return {
    kind: "strip",
    id: "streaks",
    title: "Streaks",
    subtitle: "Every day in the range, shot or not",
    headline,
    // "330 of 1,090 days" said nothing about which number was which.
    note: daysOutNote(stats),
    ...(years.length > 1
      ? {
          settings: [
            {
              id: "wall",
              label: "Lay the days out",
              value: stats.wall,
              options: [
                { value: "packed", label: "As one wall", note: "as large as the slide allows" },
                { value: "years", label: "A row per year" },
              ],
            },
            yearBasisSetting(stats),
          ],
        }
      : {}),
    days: daily,
    from: range.from,
    to: range.to,
    streak: longestStreak,
    gap: longestGap,
    years,
    layout: years.length > 1 ? stats.wall : "packed",
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
    headline:
      leader && (leader.values[lastIndex] ?? 0) > 0
        ? `${leader.label} closed out ${formatYearMonth(timeline.months[lastIndex] as number)}`
        : "How your kit rotated",
    note: pooled ? `Your ${named} most-used lenses, the rest pooled` : "Every lens you used",
    ...(rowsChoice ? { settings: [rowsChoice] } : {}),
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
 * what used to be in it, so this counts only what has vanished since this tool
 * first looked, and the note says when that was.
 */
function cullingSlide(stats: DeckStats): Slide | null {
  const { picked, rejected, unflagged, removed, removedRejected, watchingSince } = stats.culling;
  const decided = picked + rejected;
  // A library where nobody has ever flagged anything has nothing to say here.
  if (decided === 0) return null;

  const total = picked + rejected + unflagged;
  const share = (n: number) => (total > 0 ? n / total : 0);

  // The ratio rather than either share: both shares are on the cards below, and
  // no number should appear twice on one slide. It is also the way the decision
  // is actually described out loud — "I keep about one in three".
  const ratio = Math.max(picked, rejected) / Math.max(1, Math.min(picked, rejected));
  const headline =
    rejected === 0
      ? "Every flag you have set is a keeper"
      : picked === 0
        ? "The only flag you use is reject"
        : ratio < 1.15
          ? "You keep about as many as you throw out"
          : picked > rejected
            ? `You keep ${ratio.toFixed(1)} frames for every one you throw out`
            : `You throw out ${ratio.toFixed(1)} frames for every one you keep`;

  // What has actually left, which no card can hold: these frames are not in the
  // library any more, so they are in none of the counts beside it either.
  const note =
    removed > 0 && watchingSince
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
        verdict: "up",
        label: "Picked",
        value: fmtInt(picked),
        note: `${fmtPct(share(picked))} of your frames`,
      },
      {
        verdict: "down",
        label: "Rejected",
        value: fmtInt(rejected),
        note: `${fmtPct(share(rejected))} of your frames`,
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
        ["Rejected", rejected, fmtPct(share(rejected))],
        ["Neither", unflagged, fmtPct(share(unflagged))],
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

function keepersSlide(stats: DeckStats): Slide | null {
  const rated = stats.ratings.reduce((sum, n, stars) => (stars > 0 ? sum + n : sum), 0);
  if (rated === 0) return null;

  const keepers = stats.totals.keepers;
  const fourPlus = (stats.ratings[4] ?? 0) + (stats.ratings[5] ?? 0);

  // Everything that was never given a star. It dwarfs the rated frames in most
  // libraries, which is why it is a figure beside the chart rather than a sixth
  // column that would flatten the other five.
  const unrated = Math.max(0, stats.totals.shots - rated);

  return {
    kind: "columns",
    id: "keepers",
    title: "Keepers",
    subtitle: "What survived the edit",
    headline: `${fmtInt(fourPlus)} ${plural(fourPlus, "frame")} at four stars or better`,
    note: `${fmtPct(keepers / stats.totals.shots)} of the range · ratings come from Lightroom`,
    items: [1, 2, 3, 4, 5].map((stars) => ({
      label: "*".repeat(stars),
      value: stats.ratings[stars] ?? 0,
    })),
    highlight: -1,
    axisLabel: "Rating",
    figure: { value: fmtInt(unrated), label: `never rated  ·  ${fmtPct(unrated / stats.totals.shots)}` },
    table: tableOf(
      ["Rating", "Photographs"],
      [
        ...[1, 2, 3, 4, 5].map((stars): Array<string | number> => [
          `${stars} star${stars === 1 ? "" : "s"}`,
          stats.ratings[stars] ?? 0,
        ]),
        ["Never rated", unrated],
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

function debutsSlide(stats: DeckStats): Slide | null {
  if (stats.debuts.length === 0) return null;
  if (stats.range.spec.kind === "all" && stats.debuts.length > 12) return null;

  const first = stats.debuts[0];
  if (!first) return null;

  return {
    kind: "list",
    id: "debuts",
    title: "New in the bag",
    subtitle: "First frames on gear you had not used before",
    headline: `${stats.debuts.length} ${plural(stats.debuts.length, "new piece", "new pieces")} of kit`,
    note: "Dated by its first frame anywhere in your library",
    items: stats.debuts.map((debut) => ({
      label: debut.label,
      meta: `${debut.kind === "camera" ? "Camera" : "Lens"} · first frame ${formatDay(debut.day)}`,
      value: `${fmtInt(debut.shots)} ${plural(debut.shots, "frame")} since`,
    })),
    table: tableOf(
      ["Gear", "Kind", "First frame", "Frames since"],
      stats.debuts.map((debut) => [debut.label, debut.kind, formatDay(debut.day), debut.shots]),
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
    { label: "Photographs", value: fmtInt(totals.shots) },
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
      : shotsPhrase(totals.shots),
    tiles,
    table: tableOf(
      ["Measure", "Value"],
      [
        ["Photographs", totals.shots],
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
