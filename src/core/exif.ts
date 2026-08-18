import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import exifr from "exifr";
import { hasReadableExif, isQuicktimeFamily } from "./media.ts";
import { normalizeCamera, normalizeLens, cleanField, type GearName } from "./gear.ts";
import { apexToAperture, apexToShutter } from "./units.ts";
import { naiveStamp, parseExifDate } from "./time.ts";

/**
 * Everything a slide can be made of, pulled out of one file.
 *
 * Reads are header-only and never throw: a file whose metadata cannot be read
 * still counts as a photograph taken, it just contributes to fewer slides.
 */
export interface ShotMeta {
  capturedAt: number | null;
  /** Sub-second digits. Only used to tell burst frames apart. */
  subSec: number | null;
  camera: GearName | null;
  bodySerial: string | null;
  lens: GearName | null;
  /** Focal length as marked on the barrel, in mm. */
  focal: number | null;
  /** 35mm-equivalent focal length, when the camera reports one. */
  focal35: number | null;
  aperture: number | null;
  /** Exposure time in seconds. */
  shutter: number | null;
  iso: number | null;
  flash: number | null;
  width: number | null;
  height: number | null;
  orientation: number | null;
  latitude: number | null;
  longitude: number | null;
  /** Clip length in seconds, video only. */
  duration: number | null;
}

export const EMPTY_META: ShotMeta = {
  capturedAt: null,
  subSec: null,
  camera: null,
  bodySerial: null,
  lens: null,
  focal: null,
  focal35: null,
  aperture: null,
  shutter: null,
  iso: null,
  flash: null,
  width: null,
  height: null,
  orientation: null,
  latitude: null,
  longitude: null,
  duration: null,
};

export type MetaState = "ok" | "none" | "error";

export interface MetaResult {
  state: MetaState;
  meta: ShotMeta;
}

/**
 * exifr's published types are narrower than what it accepts at runtime
 * (`ifd0: true` is documented and works, but typed as an object only), so the
 * options object is kept loose and cast at the call.
 */
const EXIF_OPTIONS: Record<string, unknown> = {
  // Header-only read: exifr stops after the metadata chunk rather than pulling
  // a 60 MB raw file through memory.
  chunked: true,
  firstChunkSize: 65536,
  tiff: true,
  ifd0: true,
  exif: true,
  gps: true,
  interop: false,
  thumbnail: false,
  // Keep dates as raw strings — we want the naive wall clock, not a Date that
  // silently picks up this machine's timezone.
  reviveValues: false,
  translateKeys: true,
  translateValues: false,
  mergeOutput: true,
  sanitize: true,
};

function numberOrNull(value: unknown, min = -Infinity, max = Infinity): number | null {
  const n = typeof value === "number" ? value : Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/**
 * GPS coordinates arrive as `[degrees, minutes, seconds]` plus a hemisphere
 * letter. A few phones write a signed decimal instead, so both are accepted.
 */
function toDecimalDegrees(value: unknown, ref: unknown): number | null {
  const hemisphere = cleanField(ref).toUpperCase();
  let degrees: number | null = null;

  if (Array.isArray(value)) {
    const [d = 0, m = 0, s = 0] = value.map((v) => (typeof v === "number" ? v : Number(v)));
    if (!Number.isFinite(d)) return null;
    degrees = Math.abs(d) + (Number.isFinite(m) ? m : 0) / 60 + (Number.isFinite(s) ? s : 0) / 3600;
  } else {
    const n = numberOrNull(value);
    if (n === null) return null;
    degrees = Math.abs(n);
  }

  if (degrees === null || !Number.isFinite(degrees) || degrees > 180) return null;
  const negative = hemisphere === "S" || hemisphere === "W" || (hemisphere === "" && numberOrNull(value) !== null && (numberOrNull(value) as number) < 0);
  return Math.round((negative ? -degrees : degrees) * 1e6) / 1e6;
}

function readGps(tags: Record<string, unknown>): { latitude: number | null; longitude: number | null } {
  // exifr sometimes hands back computed decimals; prefer them when present.
  const computedLat = numberOrNull(tags.latitude, -90, 90);
  const computedLon = numberOrNull(tags.longitude, -180, 180);
  if (computedLat !== null && computedLon !== null) {
    return { latitude: computedLat, longitude: computedLon };
  }

  const latitude = toDecimalDegrees(tags.GPSLatitude, tags.GPSLatitudeRef);
  const longitude = toDecimalDegrees(tags.GPSLongitude, tags.GPSLongitudeRef);
  if (latitude === null || longitude === null) return { latitude: null, longitude: null };
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return { latitude: null, longitude: null };
  // 0,0 in the Gulf of Guinea is what a camera writes when the fix failed.
  if (latitude === 0 && longitude === 0) return { latitude: null, longitude: null };
  return { latitude, longitude };
}

async function readExifMeta(file: string): Promise<ShotMeta | null> {
  const tags = (await exifr.parse(file, EXIF_OPTIONS as never)) as Record<string, unknown> | undefined;
  if (!tags) return null;

  const capturedAt =
    parseExifDate(tags.DateTimeOriginal) ??
    parseExifDate(tags.CreateDate) ??
    parseExifDate(tags.DateTimeDigitized) ??
    parseExifDate(tags.ModifyDate);

  const subSecRaw = cleanField(tags.SubSecTimeOriginal ?? tags.SubSecTime ?? "");
  const subSec = subSecRaw === "" ? null : Number.parseInt(subSecRaw.padEnd(3, "0").slice(0, 3), 10);

  const aperture =
    numberOrNull(tags.FNumber, 0.4, 90) ??
    apexToAperture(numberOrNull(tags.ApertureValue, 0, 20) ?? NaN);

  const shutter =
    numberOrNull(tags.ExposureTime, 1 / 100000, 7200) ??
    apexToShutter(numberOrNull(tags.ShutterSpeedValue, -12, 20) ?? NaN);

  const { latitude, longitude } = readGps(tags);

  return {
    capturedAt,
    subSec: Number.isFinite(subSec) ? subSec : null,
    camera: normalizeCamera(tags.Make, tags.Model),
    bodySerial:
      cleanField(
        tags.BodySerialNumber ??
          tags.SerialNumber ??
          tags.InternalSerialNumber ??
          tags.CameraSerialNumber ??
          "",
      ) || null,
    lens: normalizeLens(
      tags.LensMake,
      tags.LensModel ?? tags.Lens ?? tags.LensType,
      tags.LensSpecification ?? tags.LensInfo,
    ),
    focal: numberOrNull(tags.FocalLength, 0.5, 5000),
    focal35: numberOrNull(tags.FocalLengthIn35mmFormat, 1, 5000),
    aperture,
    shutter,
    iso:
      numberOrNull(tags.ISO, 1, 4194304) ??
      numberOrNull(tags.ISOSpeedRatings, 1, 4194304) ??
      numberOrNull(tags.PhotographicSensitivity, 1, 4194304),
    // Bit 0 of the Flash tag is "the flash fired"; the rest is red-eye and
    // return-detection detail nobody puts on a slide.
    flash: (() => {
      const raw = numberOrNull(tags.Flash, 0, 255);
      return raw === null ? null : raw & 1;
    })(),
    width: numberOrNull(tags.ExifImageWidth ?? tags.ImageWidth, 1, 1e6),
    height: numberOrNull(tags.ExifImageHeight ?? tags.ImageHeight, 1, 1e6),
    orientation: numberOrNull(tags.Orientation, 1, 8),
    latitude,
    longitude,
    duration: null,
  };
}

// ------------------------------------------------------------- QuickTime ----

/** Seconds between the QuickTime epoch (1904-01-01) and the Unix epoch. */
const QT_EPOCH_OFFSET = 2082844800;

/** A clip's `moov` is normally tiny; this cap keeps a broken file from OOMing us. */
const MAX_MOOV_BYTES = 8 * 1024 * 1024;

interface BoxHeader {
  size: number;
  type: string;
  headerSize: number;
}

async function readBoxHeader(fh: FileHandle, offset: number, limit: number): Promise<BoxHeader | null> {
  const header = Buffer.alloc(16);
  const { bytesRead } = await fh.read(header, 0, 16, offset);
  if (bytesRead < 8) return null;

  let size = header.readUInt32BE(0);
  const type = header.toString("latin1", 4, 8);
  let headerSize = 8;

  if (size === 1) {
    if (bytesRead < 16) return null;
    const large = header.readBigUInt64BE(8);
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(large);
    headerSize = 16;
  } else if (size === 0) {
    size = limit - offset; // Box extends to the end of its parent.
  }

  if (size < headerSize || offset + size > limit) return null;
  return { size, type, headerSize };
}

/**
 * Reads capture time, duration and — when the camera bothered to write them —
 * make and model out of an mp4/mov.
 *
 * exifr does not handle these at all, and on a hybrid shooter's card video is
 * half the files. Only the `moov` box is read; `mdat` (the actual footage, up
 * to hundreds of gigabytes) is stepped over by offset and never touched.
 */
async function readQuicktimeMeta(file: string): Promise<ShotMeta | null> {
  const fh = await fs.open(file, "r");
  try {
    const { size } = await fh.stat();
    let offset = 0;

    while (offset < size) {
      const box = await readBoxHeader(fh, offset, size);
      if (!box) return null;

      if (box.type === "moov") {
        const length = Math.min(box.size, MAX_MOOV_BYTES);
        const buffer = Buffer.alloc(length);
        await fh.read(buffer, 0, length, offset);
        return parseMoov(buffer.subarray(box.headerSize));
      }

      offset += box.size;
    }
    return null;
  } finally {
    await fh.close();
  }
}

/** Walks a box list in memory, calling `visit` for each child. */
function eachBox(buffer: Buffer, visit: (type: string, body: Buffer) => void): void {
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    let headerSize = 8;

    if (size === 1) {
      if (offset + 16 > buffer.length) return;
      const large = buffer.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return;
      size = Number(large);
      headerSize = 16;
    } else if (size === 0) {
      size = buffer.length - offset;
    }

    if (size < headerSize || offset + size > buffer.length) return;
    visit(type, buffer.subarray(offset + headerSize, offset + size));
    offset += size;
  }
}

function parseMoov(moov: Buffer): ShotMeta | null {
  const meta: ShotMeta = { ...EMPTY_META };

  eachBox(moov, (type, body) => {
    if (type === "mvhd") readMvhd(body, meta);
    else if (type === "udta") readUdta(body, meta);
  });

  if (meta.capturedAt === null && meta.camera === null && meta.duration === null) return null;
  return meta;
}

function readMvhd(body: Buffer, meta: ShotMeta): void {
  if (body.length < 20) return;
  const version = body.readUInt8(0);

  let created: number;
  let timescale: number;
  let duration: number;

  if (version === 1) {
    if (body.length < 32) return;
    created = Number(body.readBigUInt64BE(4));
    timescale = body.readUInt32BE(20);
    duration = Number(body.readBigUInt64BE(24));
  } else {
    created = body.readUInt32BE(4);
    timescale = body.readUInt32BE(12);
    duration = body.readUInt32BE(16);
  }

  if (timescale > 0 && duration > 0 && duration !== 0xffffffff) {
    meta.duration = Math.round((duration / timescale) * 10) / 10;
  }
  if (created === 0) return;

  // QuickTime nominally stores UTC. Read it as UTC on both sides of any
  // comparison and a camera that actually wrote local time still lines up.
  const date = new Date((created - QT_EPOCH_OFFSET) * 1000);
  if (Number.isNaN(date.getTime())) return;

  meta.capturedAt = naiveStamp(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  );
}

/** The four-character tags QuickTime uses for maker and model. */
const UDTA_MAKE = "©mak";
const UDTA_MODEL = "©mod";

function readUdta(udta: Buffer, meta: ShotMeta): void {
  let make = "";
  let model = "";

  const collect = (type: string, body: Buffer) => {
    if (type === UDTA_MAKE) make = make || readTextAtom(body);
    else if (type === UDTA_MODEL) model = model || readTextAtom(body);
    else if (type === "meta") {
      // `meta` is a full box: 4 bytes of version/flags before its children.
      if (body.length > 4) eachBox(body.subarray(4), collect);
    } else if (type === "ilst" || type === "keys") {
      eachBox(body, collect);
    }
  };

  eachBox(udta, collect);
  if (make !== "" || model !== "") {
    meta.camera = normalizeCamera(make, model);
  }
}

/**
 * Text lives one of two ways: a bare QuickTime string prefixed by its length
 * and a language code, or an iTunes-style `data` box. Both show up in the wild,
 * sometimes in the same file.
 */
function readTextAtom(body: Buffer): string {
  if (body.length >= 12 && body.toString("latin1", 4, 8) === "data") {
    return cleanField(body.subarray(16).toString("utf8"));
  }
  if (body.length >= 4) {
    const length = body.readUInt16BE(0);
    if (length > 0 && length <= body.length - 4) {
      return cleanField(body.subarray(4, 4 + length).toString("utf8"));
    }
  }
  return cleanField(body.toString("utf8"));
}

// ------------------------------------------------------------------ read ----

/** True when a read produced anything a slide could use. */
function hasSignal(meta: ShotMeta): boolean {
  return (
    meta.capturedAt !== null ||
    meta.camera !== null ||
    meta.lens !== null ||
    meta.focal !== null ||
    meta.iso !== null
  );
}

/**
 * Best-effort capture metadata. Never throws — an unreadable header means one
 * file contributes to fewer slides, not that a scan fails.
 */
export async function readShotMeta(file: string, ext: string): Promise<MetaResult> {
  try {
    let meta: ShotMeta | null = null;

    if (hasReadableExif(ext)) {
      meta = await readExifMeta(file);
    } else if (isQuicktimeFamily(ext)) {
      meta = await readQuicktimeMeta(file);
    }

    if (!meta) return { state: "none", meta: EMPTY_META };
    return { state: hasSignal(meta) ? "ok" : "none", meta };
  } catch {
    return { state: "error", meta: EMPTY_META };
  }
}
