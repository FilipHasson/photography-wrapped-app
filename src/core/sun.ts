import { dayParts, daysBetween, makeDay } from "./time.ts";

/**
 * When the sun rises and sets, in the clock the camera was using.
 *
 * The clock slide shades its hours by daylight, and "daylight" is not a fixed
 * pair of numbers: sunrise in Stockholm in June is a different hour entirely
 * from sunrise in Florida in January. Given where the photographs were taken
 * and roughly when, this says which hours were lit.
 *
 * **Local solar time, not civil time.** Capture timestamps here carry no
 * timezone (see `core/time.ts`), so there is no offset to convert into — and
 * none is needed: longitude cancels out of the sunrise equation once the answer
 * is expressed in local solar time. That lands within a few minutes of the
 * camera's clock for anyone whose timezone matches their longitude, and within
 * about half an hour for anyone whose does not. It is a shading, not a claim
 * about when the sun came up.
 *
 * The algorithm is the NOAA solar calculator's, which is accurate to about a
 * minute — far past what colouring twenty-four spokes needs.
 */

export interface SunTimes {
  /** Hour of the day as a fraction: 6.5 is half past six. */
  sunrise: number;
  sunset: number;
}

const RAD = Math.PI / 180;

/** Sun's centre 50 arcminutes below the horizon: the standard for sunrise. */
const ZENITH = 90.833;

function dayOfYear(day: number): number {
  const { year } = dayParts(day);
  return daysBetween(makeDay(year, 1, 1), day) + 1;
}

/**
 * `null` when the sun does not cross the horizon that day at that latitude —
 * a polar summer or winter, where "daylight hours" has no answer to give.
 */
export function sunTimes(latitude: number, day: number): SunTimes | null {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) return null;

  const { year } = dayParts(day);
  const daysInYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;

  // Fractional year, in radians, measured from the start of the year.
  const gamma = ((2 * Math.PI) / daysInYear) * (dayOfYear(day) - 1 + 0.5);

  // How far the sun runs ahead of or behind clock time, in minutes.
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  // The tilt of the earth, expressed as the sun's angle above the equator.
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const lat = latitude * RAD;
  const cosHourAngle =
    Math.cos(ZENITH * RAD) / (Math.cos(lat) * Math.cos(declination)) -
    Math.tan(lat) * Math.tan(declination);

  // Outside [-1, 1] the sun never reaches the horizon: midnight sun, or none.
  if (cosHourAngle > 1 || cosHourAngle < -1) return null;

  const hourAngle = Math.acos(cosHourAngle) / RAD;
  // Longitude cancels here, which is the whole reason this works without a
  // timezone: the answer is in local solar time by construction.
  const noon = 12 - eqTime / 60;

  return { sunrise: noon - hourAngle / 15, sunset: noon + hourAngle / 15 };
}

/** `06:42` — for saying which hours the shading is calling daylight. */
export function formatHour(hour: number): string {
  const wrapped = ((hour % 24) + 24) % 24;
  const hours = Math.floor(wrapped);
  const minutes = Math.round((wrapped - hours) * 60);
  const carry = minutes === 60;
  return `${String((hours + (carry ? 1 : 0)) % 24).padStart(2, "0")}:${String(carry ? 0 : minutes).padStart(2, "0")}`;
}
