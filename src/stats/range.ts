import {
  addDays,
  dayParts,
  daysBetween,
  daysInMonth,
  formatDay,
  formatIsoDay,
  isValidDay,
  makeDay,
  monthName,
  parseIsoDay,
  todayDay,
} from "../core/time.ts";

/**
 * What span of time a deck covers.
 *
 * Three shapes of question, one mechanism: a monthly report, an annual wrapped,
 * and "everything I have ever shot" are all just a pair of inclusive days. Each
 * range also carries the window immediately before it, of the same length, so
 * every slide can say whether the number went up or down without a second
 * round of range arithmetic.
 */

export type RangeSpec =
  | { kind: "all" }
  | { kind: "year"; year: number }
  | { kind: "month"; year: number; month: number }
  | { kind: "last"; days: number }
  | { kind: "custom"; from: number; to: number };

export interface Window {
  from: number;
  to: number;
  label: string;
}

export interface Range extends Window {
  spec: RangeSpec;
  /** Length in days, inclusive of both ends. */
  days: number;
  /** The equally long window ending the day before `from`. */
  previous: Window | null;
}

export interface RangeBounds {
  firstDay: number | null;
  lastDay: number | null;
}

/** Longest span a custom range may cover, as a guard against silly input. */
const MAX_DAYS = 366 * 60;

function spanLabel(from: number, to: number): string {
  if (from === to) return formatDay(from);
  const a = dayParts(from);
  const b = dayParts(to);
  if (a.year === b.year && a.month === b.month && a.day === 1 && b.day === daysInMonth(b.year, b.month)) {
    return `${monthName(a.month)} ${a.year}`;
  }
  if (a.year === b.year) {
    return `${a.day} ${monthName(a.month, true)} – ${b.day} ${monthName(b.month, true)} ${b.year}`;
  }
  return `${formatDay(from)} – ${formatDay(to)}`;
}

function previousWindow(from: number, to: number): Window {
  const length = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(length - 1));
  return { from: prevFrom, to: prevTo, label: spanLabel(prevFrom, prevTo) };
}

/**
 * Turns a spec into concrete days.
 *
 * `bounds` is what the index actually holds, and it only matters for "all
 * time" — every other range means what it says whether or not there are
 * photographs in it, because "you shot nothing last month" is a real answer.
 */
export function resolveRange(spec: RangeSpec, bounds: RangeBounds, now = new Date()): Range {
  const today = todayDay(now);

  switch (spec.kind) {
    case "all": {
      const from = bounds.firstDay ?? today;
      const to = bounds.lastDay ?? today;
      return {
        spec,
        from,
        to,
        label: "All time",
        days: daysBetween(from, to) + 1,
        // Nothing precedes everything.
        previous: null,
      };
    }

    case "year": {
      const from = makeDay(spec.year, 1, 1);
      const to = makeDay(spec.year, 12, 31);
      return {
        spec,
        from,
        to,
        label: String(spec.year),
        days: daysBetween(from, to) + 1,
        previous: {
          from: makeDay(spec.year - 1, 1, 1),
          to: makeDay(spec.year - 1, 12, 31),
          label: String(spec.year - 1),
        },
      };
    }

    case "month": {
      const from = makeDay(spec.year, spec.month, 1);
      const to = makeDay(spec.year, spec.month, daysInMonth(spec.year, spec.month));
      const prevYear = spec.month === 1 ? spec.year - 1 : spec.year;
      const prevMonth = spec.month === 1 ? 12 : spec.month - 1;
      return {
        spec,
        from,
        to,
        label: `${monthName(spec.month)} ${spec.year}`,
        days: daysBetween(from, to) + 1,
        previous: {
          from: makeDay(prevYear, prevMonth, 1),
          to: makeDay(prevYear, prevMonth, daysInMonth(prevYear, prevMonth)),
          label: `${monthName(prevMonth)} ${prevYear}`,
        },
      };
    }

    case "last": {
      const days = Math.max(1, Math.min(Math.round(spec.days), MAX_DAYS));
      const from = addDays(today, -(days - 1));
      return {
        spec: { kind: "last", days },
        from,
        to: today,
        label: days === 1 ? "Today" : `Last ${days} days`,
        days,
        previous: previousWindow(from, today),
      };
    }

    case "custom": {
      const from = Math.min(spec.from, spec.to);
      const to = Math.max(spec.from, spec.to);
      return {
        spec: { kind: "custom", from, to },
        from,
        to,
        label: spanLabel(from, to),
        days: daysBetween(from, to) + 1,
        previous: previousWindow(from, to),
      };
    }
  }
}

/**
 * Reads a spec off query parameters. Anything unrecognised falls back to all
 * time rather than erroring — a deck with a mistyped URL should still render.
 */
export function parseRangeSpec(params: URLSearchParams): RangeSpec {
  const kind = params.get("range") ?? "all";

  if (kind === "year") {
    const year = Number(params.get("year"));
    if (Number.isInteger(year) && year >= 1900 && year <= 2999) return { kind: "year", year };
  }

  if (kind === "month") {
    const year = Number(params.get("year"));
    const month = Number(params.get("month"));
    if (
      Number.isInteger(year) && year >= 1900 && year <= 2999 &&
      Number.isInteger(month) && month >= 1 && month <= 12
    ) {
      return { kind: "month", year, month };
    }
  }

  if (kind === "last") {
    const days = Number(params.get("days"));
    if (Number.isFinite(days) && days >= 1) return { kind: "last", days: Math.round(days) };
  }

  if (kind === "custom") {
    const from = parseIsoDay(params.get("from") ?? "");
    const to = parseIsoDay(params.get("to") ?? "");
    if (from !== null && to !== null && isValidDay(from) && isValidDay(to)) {
      return { kind: "custom", from, to };
    }
  }

  return { kind: "all" };
}

/** The inverse, for links the page builds. */
export function rangeQuery(spec: RangeSpec): string {
  const params = new URLSearchParams({ range: spec.kind });
  if (spec.kind === "year") params.set("year", String(spec.year));
  if (spec.kind === "month") {
    params.set("year", String(spec.year));
    params.set("month", String(spec.month));
  }
  if (spec.kind === "last") params.set("days", String(spec.days));
  if (spec.kind === "custom") {
    params.set("from", formatIsoDay(spec.from));
    params.set("to", formatIsoDay(spec.to));
  }
  return params.toString();
}
