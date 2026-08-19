import type { DeckStats, DayCount, Place, Series } from "./aggregate.ts";
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

interface Common {
  id: string;
  title: string;
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
      items: Array<{ label: string; value: number; valueLabel: string; share: number; muted?: boolean }>;
    })
  | (Common & {
      kind: "columns";
      items: Array<{ label: string; value: number }>;
      highlight: number;
      axisLabel: string;
    })
  | (Common & { kind: "clock"; hours: number[] })
  | (Common & { kind: "week"; days: number[] })
  | (Common & { kind: "calendar"; days: DayCount[]; from: number; to: number })
  | (Common & { kind: "months"; months: Array<{ ym: number; shots: number }> })
  | (Common & { kind: "stack"; months: number[]; series: Series[] })
  | (Common & { kind: "map"; points: Place[] })
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

  const rhythm = [clockSlide(stats), weekSlide(stats), calendarSlide(stats), timelineSlide(stats)];
  for (const slide of rhythm) if (slide) slides.push(slide);

  const extras = [
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
    { label: "On disk", value: fmtBytes(totals.bytes), note: `${fmtInt(totals.files)} files` },
  ];

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
    note:
      [
        totals.files > totals.shots
          ? `${fmtInt(totals.files)} files, counted as ${fmtInt(totals.shots)} photographs — raw and JPEG pairs, and files seen by more than one source, count once.`
          : "",
        // Both of these change every number on every slide, so they are said
        // once, plainly, on the slide that opens the deck.
        range.clipped ? `Starts at ${formatDay(range.from)}; anything earlier is left out of this library.` : "",
        stats.hiddenCameras.length + stats.hiddenLenses.length > 0
          ? `${stats.hiddenCameras.length + stats.hiddenLenses.length} pieces of gear are hidden.`
          : "",
      ]
        .filter(Boolean)
        .join(" ") || undefined,
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

/** Bars past this are a wall rather than a chart; the tail pools into one. */
const TOP_BARS = 8;

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

  // Drawn: the leaders, then everything else as one bar.
  const drawn = rows.slice(0, TOP_BARS).map((row) => ({
    label: row.label,
    value: row.shots,
    valueLabel: `${fmtInt(row.shots)}  ·  ${fmtPct(row.share)}`,
    share: row.share,
    muted: false,
  }));

  const tail = rows.slice(TOP_BARS);
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

  const subject = noun === "pairing" ? "both a body and a lens" : `a ${noun}`;
  const coverage =
    known < stats.totals.shots
      ? `${fmtInt(known)} of ${shotsPhrase(stats.totals.shots)} recorded ${subject}; the rest are not counted here.`
      : undefined;

  const hiddenNote =
    hidden.length > 0
      ? `${hidden.length} hidden and left out of every count on every slide: ${hidden.map((row) => row.label).join(", ")}.`
      : "";

  return {
    kind: "bars",
    id: field,
    title,
    subtitle,
    headline,
    note: [coverage, hiddenNote].filter(Boolean).join(" ") || undefined,
    items: drawn,
    table: {
      columns: [title, "Photographs", "Share", "First", "Last"],
      rows: listed.map((row) => [
        row.label,
        row.shots,
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
      widest && longest ? `From ${widest.label} to ${longest.label}.` : "",
      topClass ? `Mostly ${topClass.label} work (${fmtPct(topClass.shots / focal.known)}).` : "",
      `Known for ${fmtInt(focal.known)} of ${shotsPhrase(stats.totals.shots)}.`,
    ]
      .filter(Boolean)
      .join(" "),
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
    note: `${fmtPct(wideOpen / aperture.known)} at f/2 or wider, ${fmtPct(stoppedDown / aperture.known)} at f/8 or smaller. Known for ${fmtInt(aperture.known)} frames.`,
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
      base && highest ? `${base.label} to ${highest.label}.` : "",
      `${fmtPct(high / iso.known)} of frames at ISO 3200 or above.`,
      `Known for ${fmtInt(iso.known)} frames.`,
    ]
      .filter(Boolean)
      .join(" "),
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
      fastest && slowest ? `Fastest ${fastest.label}, slowest ${slowest.label}.` : "",
      long > 0 ? `${fmtInt(long)} ${plural(long, "frame")} at a second or longer.` : "",
      `Known for ${fmtInt(shutter.known)} frames.`,
    ]
      .filter(Boolean)
      .join(" "),
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

  const night = [22, 23, 0, 1, 2, 3, 4].reduce((sum, hour) => sum + (stats.hours[hour] ?? 0), 0);
  const morning = [5, 6, 7, 8, 9].reduce((sum, hour) => sum + (stats.hours[hour] ?? 0), 0);

  const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

  return {
    kind: "clock",
    id: "clock",
    title: "Time of day",
    subtitle: "When the shutter goes",
    headline: `${hourLabel(peak)} is your hour — ${fmtPct((stats.hours[peak] ?? 0) / total)} of everything`,
    note: `${fmtPct(morning / total)} between 05:00 and 10:00, ${fmtPct(night / total)} between 22:00 and 05:00. Clock time as the camera recorded it, never converted.`,
    hours: stats.hours,
    table: tableOf(
      ["Hour", "Photographs"],
      stats.hours.map((shots, hour) => [hourLabel(hour), shots]),
    ),
  };
}

function weekSlide(stats: DeckStats): Slide | null {
  const total = stats.weekdays.reduce((sum, n) => sum + n, 0);
  if (total === 0) return null;

  let busiest = 0;
  for (let day = 1; day < 7; day++) {
    if ((stats.weekdays[day] ?? 0) > (stats.weekdays[busiest] ?? 0)) busiest = day;
  }
  const weekend = (stats.weekdays[5] ?? 0) + (stats.weekdays[6] ?? 0);

  return {
    kind: "week",
    id: "week",
    title: "Day of the week",
    subtitle: "The shape of your week",
    headline: `${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][busiest]} is your day`,
    note: `${fmtPct(weekend / total)} of your frames were taken at the weekend.`,
    days: stats.weekdays,
    table: tableOf(
      ["Day", "Photographs"],
      stats.weekdays.map((shots, day) => [WEEKDAYS[day] ?? "", shots]),
    ),
  };
}

function calendarSlide(stats: DeckStats): Slide | null {
  const { busiestDay, longestStreak, longestGap, range } = stats;
  if (!busiestDay) return null;

  const notes: string[] = [];
  if (longestStreak && longestStreak.days > 1) {
    notes.push(
      `Longest run: ${longestStreak.days} days straight, ${formatDay(longestStreak.from)} to ${formatDay(longestStreak.to)}.`,
    );
  }
  if (longestGap && longestGap.days > 1) {
    notes.push(
      `Longest quiet spell: ${fmtInt(longestGap.days)} days between ${formatDay(longestGap.from)} and ${formatDay(longestGap.to)}.`,
    );
  }

  const headline = `${formatDay(busiestDay.day)} — ${shotsPhrase(busiestDay.shots)} in one day`;

  if (stats.daily.length > 0) {
    return {
      kind: "calendar",
      id: "calendar",
      title: "Every day",
      subtitle: "One square per day",
      headline,
      note: notes.join(" "),
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
    note: notes.join(" "),
    months: stats.monthly,
    table: tableOf(
      ["Month", "Photographs"],
      stats.monthly.map((entry) => [formatYearMonth(entry.ym), entry.shots]),
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

  return {
    kind: "stack",
    id: "timeline",
    title: "Gear over time",
    subtitle: "What was on the camera, month by month",
    headline:
      leader && (leader.values[lastIndex] ?? 0) > 0
        ? `${leader.label} closed out ${formatYearMonth(timeline.months[lastIndex] as number)}`
        : "How your kit rotated",
    note: pooled
      ? `Your ${named} most-used lenses, with everything else pooled.`
      : `Every lens you used, month by month.`,
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

function keepersSlide(stats: DeckStats): Slide | null {
  const rated = stats.ratings.reduce((sum, n, stars) => (stars > 0 ? sum + n : sum), 0);
  if (rated === 0) return null;

  const keepers = stats.totals.keepers;
  const fourPlus = (stats.ratings[4] ?? 0) + (stats.ratings[5] ?? 0);

  return {
    kind: "columns",
    id: "keepers",
    title: "Keepers",
    subtitle: "What survived the edit",
    headline: `${fmtInt(fourPlus)} ${plural(fourPlus, "frame")} at four stars or better`,
    note: `${fmtPct(keepers / stats.totals.shots)} of everything you shot in this range. Ratings come from your Lightroom catalog; ${fmtInt(rated)} ${plural(rated, "frame")} carry one.`,
    items: [1, 2, 3, 4, 5].map((stars) => ({
      label: "*".repeat(stars),
      value: stats.ratings[stars] ?? 0,
    })),
    highlight: -1,
    axisLabel: "Rating",
    table: tableOf(
      ["Rating", "Photographs"],
      [1, 2, 3, 4, 5].map((stars) => [`${stars} star${stars === 1 ? "" : "s"}`, stats.ratings[stars] ?? 0]),
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
    note:
      oriented < totals.shots
        ? `Orientation known for ${fmtInt(oriented)} of ${shotsPhrase(totals.shots)}.`
        : undefined,
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
    note: `${fmtInt(stats.placesKnown)} of ${shotsPhrase(stats.totals.shots)} carry a GPS fix. Positions are rounded to a tenth of a degree — roughly 11km — and the frame is drawn around them rather than around the world.`,
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
    note: "Dated by the first frame ever taken with it, anywhere in your library.",
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

  return {
    kind: "hero",
    id: "burst",
    title: "The longest burst",
    headline: `${fmtInt(burst.frames)} frames without letting go`,
    value: fmtInt(burst.frames),
    caption: `frames in ${burst.seconds <= 1 ? "under a second" : `${fmtInt(burst.seconds)} seconds`}`,
    subtitle: `${formatDay(burst.day)}${burst.camera ? ` · ${burst.camera}` : ""}`,
    note: "Counted as frames with no more than two seconds between them.",
    tiles: [
      { label: "Frames", value: fmtInt(burst.frames) },
      { label: "Seconds", value: fmtInt(burst.seconds) },
      { label: "Rate", value: `${rate.toFixed(1)}/s` },
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
