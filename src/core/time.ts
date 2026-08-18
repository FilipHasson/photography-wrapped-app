/**
 * Dates here are integers, not timestamps.
 *
 * A capture time is stored as a timezone-free `YYYYMMDDHHMMSS` integer and a
 * day as `YYYYMMDD`. EXIF timestamps carry no zone and neither does Lightroom's
 * `captureTime`; turning them into epoch milliseconds would mean inventing an
 * offset, and a shoot in Tokyo would land on the wrong day the moment the
 * laptop flew home. The wall clock the camera wrote is the truth this tool
 * reports, so it is the thing we store and group by.
 *
 * Day arithmetic goes through `Date.UTC` — that is calendar maths on a fixed
 * zone, not a local-time conversion, so it stays deterministic.
 */

export const MS_PER_DAY = 86400000;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Monday first: charts read better when the weekend sits together at the end. */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function naiveStamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  return year * 1e10 + month * 1e8 + day * 1e6 + hour * 1e4 + minute * 100 + second;
}

/** Accepts `2024:05:01 14:23:45`, ISO, and the mixed forms cameras emit. */
export function parseExifDate(value: unknown): number | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return naiveStamp(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
    );
  }
  if (typeof value !== "string") return null;

  const m = value.trim().match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) {
    // Lightroom occasionally stores a date with no time at all.
    const dateOnly = value.trim().match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})$/);
    if (!dateOnly) return null;
    const [, dy, dmo, dd] = dateOnly;
    const stamp = naiveStamp(Number(dy), Number(dmo), Number(dd), 12, 0, 0);
    return isPlausible(stamp) ? stamp : null;
  }

  const [, y, mo, d, h, mi, s] = m;
  const stamp = naiveStamp(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s));
  return isPlausible(stamp) ? stamp : null;
}

/**
 * Cameras with a dead clock battery emit 1970, 2000-01-01, or 0000:00:00, and
 * one such file stretches an all-time deck across fifty empty years. Anything
 * before photography-on-a-memory-card existed is treated as unknown.
 */
function isPlausible(stamp: number): boolean {
  return stamp >= 19900101000000 && stamp <= 21000101000000;
}

export const dayOf = (stamp: number): number => Math.floor(stamp / 1e6);
export const yearOf = (stamp: number): number => Math.floor(stamp / 1e10);
export const monthOf = (stamp: number): number => Math.floor(stamp / 1e8) % 100;
export const hourOf = (stamp: number): number => Math.floor(stamp / 1e4) % 100;
export const minuteOf = (stamp: number): number => Math.floor(stamp / 100) % 100;

/** `YYYYMM` — the grouping key for a monthly timeline. */
export const yearMonthOf = (stamp: number): number => Math.floor(stamp / 1e8);

export function makeDay(year: number, month: number, day: number): number {
  return year * 10000 + month * 100 + day;
}

export function dayParts(day: number): { year: number; month: number; day: number } {
  return {
    year: Math.floor(day / 10000),
    month: Math.floor(day / 100) % 100,
    day: day % 100,
  };
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(day: number): number {
  const { year, month, day: d } = dayParts(day);
  return (Date.UTC(year, month - 1, d) / MS_PER_DAY + 3) % 7 | 0;
}

export function addDays(day: number, delta: number): number {
  const { year, month, day: d } = dayParts(day);
  const moved = new Date(Date.UTC(year, month - 1, d) + delta * MS_PER_DAY);
  return makeDay(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: number, to: number): number {
  const a = dayParts(from);
  const b = dayParts(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / MS_PER_DAY,
  );
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function todayDay(now = new Date()): number {
  return makeDay(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function isValidDay(day: number): boolean {
  if (!Number.isInteger(day) || day < 19000101 || day > 29991231) return false;
  const { year, month, day: d } = dayParts(day);
  return month >= 1 && month <= 12 && d >= 1 && d <= daysInMonth(year, month);
}

/** `2025-03-12` → `20250312`. Returns null for anything else. */
export function parseIsoDay(value: string): number | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const day = makeDay(Number(m[1]), Number(m[2]), Number(m[3]));
  return isValidDay(day) ? day : null;
}

export function formatIsoDay(day: number): string {
  const { year, month, day: d } = dayParts(day);
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function formatDay(day: number): string {
  const { year, month, day: d } = dayParts(day);
  return `${d} ${MONTHS_SHORT[month - 1]} ${year}`;
}

export function monthName(month: number, short = false): string {
  return (short ? MONTHS_SHORT : MONTHS)[month - 1] ?? "";
}

/** `202503` → `Mar 2025`. */
export function formatYearMonth(ym: number, short = true): string {
  return `${monthName(ym % 100, short)} ${Math.floor(ym / 100)}`;
}

export function formatClock(stamp: number): string {
  return `${String(hourOf(stamp)).padStart(2, "0")}:${String(minuteOf(stamp)).padStart(2, "0")}`;
}

/**
 * The same wall clock as a count of seconds, so differences between two
 * captures are plain arithmetic.
 *
 * Not a real epoch — the stamp has no timezone, so this reads it as if it were
 * UTC. That is exactly right for "how many seconds between these two frames",
 * which is the only thing it is used for, and it stays wrong in the same
 * direction for both operands.
 */
export function epochSecondsOf(stamp: number): number {
  const { year, month, day } = dayParts(dayOf(stamp));
  return (
    Date.UTC(year, month - 1, day) / 1000 +
    hourOf(stamp) * 3600 +
    minuteOf(stamp) * 60 +
    (stamp % 100)
  );
}
