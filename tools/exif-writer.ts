/**
 * Builds tiny JPEGs carrying real EXIF, and tiny MP4s carrying a real `moov`.
 *
 * Every claim this tool makes rests on reading metadata correctly, which can
 * only be tested against files that actually contain some. Rather than commit
 * binary blobs, the fixtures synthesise a minimal but genuinely valid APP1/TIFF
 * block that exifr parses exactly as it would a camera's — lens name, aperture,
 * shutter, ISO, GPS and all.
 */

const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

// IFD0
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_ORIENTATION = 0x0112;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;

// Exif IFD
const TAG_EXPOSURE_TIME = 0x829a;
const TAG_FNUMBER = 0x829d;
const TAG_ISO = 0x8827;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_FLASH = 0x9209;
const TAG_FOCAL_LENGTH = 0x920a;
const TAG_SUB_SEC_TIME_ORIGINAL = 0x9291;
const TAG_EXIF_IMAGE_WIDTH = 0xa002;
const TAG_EXIF_IMAGE_HEIGHT = 0xa003;
const TAG_FOCAL_LENGTH_35 = 0xa405;
const TAG_BODY_SERIAL = 0xa431;
const TAG_LENS_MAKE = 0xa433;
const TAG_LENS_MODEL = 0xa434;

// GPS IFD
const TAG_GPS_LAT_REF = 1;
const TAG_GPS_LAT = 2;
const TAG_GPS_LON_REF = 3;
const TAG_GPS_LON = 4;

interface TagValue {
  tag: number;
  type: number;
  count: number;
  data: Buffer;
}

function ascii(tag: number, value: string): TagValue {
  const data = Buffer.from(`${value}\0`, "latin1");
  return { tag, type: TYPE_ASCII, count: data.length, data };
}

function short(tag: number, value: number): TagValue {
  const data = Buffer.alloc(2);
  data.writeUInt16LE(value, 0);
  return { tag, type: TYPE_SHORT, count: 1, data };
}

function long(tag: number, value: number): TagValue {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(value, 0);
  return { tag, type: TYPE_LONG, count: 1, data };
}

/** TIFF has no floats: every real number is a pair of 32-bit integers. */
function rational(tag: number, values: Array<[number, number]>): TagValue {
  const data = Buffer.alloc(values.length * 8);
  values.forEach(([numerator, denominator], i) => {
    data.writeUInt32LE(Math.round(numerator), i * 8);
    data.writeUInt32LE(Math.round(denominator), i * 8 + 4);
  });
  return { tag, type: TYPE_RATIONAL, count: values.length, data };
}

/** Approximates a decimal as a rational with a denominator that keeps it exact enough. */
function fromDecimal(value: number, denominator = 1000): [number, number] {
  return [Math.round(value * denominator), denominator];
}

/**
 * Lays out one IFD plus its overflow data area.
 *
 * Values of four bytes or fewer live inline in the entry; anything larger is
 * appended after the directory and referenced by offset from the TIFF header.
 */
function serializeIfd(entries: TagValue[], ifdStart: number, nextIfd: number): Buffer {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);
  const ifdSize = 2 + sorted.length * 12 + 4;

  const directory = Buffer.alloc(ifdSize);
  const overflow: Buffer[] = [];
  let dataOffset = ifdStart + ifdSize;

  directory.writeUInt16LE(sorted.length, 0);

  for (const [i, entry] of sorted.entries()) {
    const at = 2 + i * 12;
    directory.writeUInt16LE(entry.tag, at);
    directory.writeUInt16LE(entry.type, at + 2);
    directory.writeUInt32LE(entry.count, at + 4);

    if (entry.data.length <= 4) {
      entry.data.copy(directory, at + 8);
    } else {
      directory.writeUInt32LE(dataOffset, at + 8);
      // TIFF requires values to start on a word boundary.
      const padded =
        entry.data.length % 2 === 0 ? entry.data : Buffer.concat([entry.data, Buffer.alloc(1)]);
      overflow.push(padded);
      dataOffset += padded.length;
    }
  }

  directory.writeUInt32LE(nextIfd, 2 + sorted.length * 12);
  return Buffer.concat([directory, ...overflow]);
}

export interface ExifSpec {
  make: string;
  model: string;
  serial?: string;
  /** `YYYY:MM:DD HH:MM:SS`. */
  dateTimeOriginal: string;
  subSec?: string;
  lensMake?: string;
  lensModel?: string;
  /** Millimetres, as marked on the barrel. */
  focalLength?: number;
  focalLength35?: number;
  /** f-number, e.g. 2.8. */
  aperture?: number;
  /** Seconds, e.g. 1/250 = 0.004. */
  shutter?: number;
  iso?: number;
  /** Bit 0 is "fired", which is all this tool reads. */
  flash?: number;
  width?: number;
  height?: number;
  /** 1 = as shot, 6 and 8 = rotated a quarter turn. */
  orientation?: number;
  latitude?: number;
  longitude?: number;
}

function degreesToRationals(value: number): Array<[number, number]> {
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutesFloat = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = (minutesFloat - minutes) * 60;
  return [
    [degrees, 1],
    [minutes, 1],
    [Math.round(seconds * 100), 100],
  ];
}

function buildTiff(spec: ExifSpec): Buffer {
  const header = Buffer.alloc(8);
  header.write("II", 0, "latin1");
  header.writeUInt16LE(0x002a, 2);
  header.writeUInt32LE(8, 4); // IFD0 immediately follows the header.

  const exifEntries: TagValue[] = [ascii(TAG_DATE_TIME_ORIGINAL, spec.dateTimeOriginal)];
  if (spec.subSec) exifEntries.push(ascii(TAG_SUB_SEC_TIME_ORIGINAL, spec.subSec));
  if (spec.serial) exifEntries.push(ascii(TAG_BODY_SERIAL, spec.serial));
  if (spec.lensMake) exifEntries.push(ascii(TAG_LENS_MAKE, spec.lensMake));
  if (spec.lensModel) exifEntries.push(ascii(TAG_LENS_MODEL, spec.lensModel));
  if (spec.focalLength !== undefined) {
    exifEntries.push(rational(TAG_FOCAL_LENGTH, [fromDecimal(spec.focalLength, 10)]));
  }
  if (spec.focalLength35 !== undefined) {
    exifEntries.push(short(TAG_FOCAL_LENGTH_35, Math.round(spec.focalLength35)));
  }
  if (spec.aperture !== undefined) {
    exifEntries.push(rational(TAG_FNUMBER, [fromDecimal(spec.aperture, 100)]));
  }
  if (spec.shutter !== undefined) {
    // Written the way a camera does: 1/250 rather than 0.004.
    exifEntries.push(
      rational(TAG_EXPOSURE_TIME, [
        spec.shutter >= 1 ? [Math.round(spec.shutter), 1] : [1, Math.round(1 / spec.shutter)],
      ]),
    );
  }
  if (spec.iso !== undefined) exifEntries.push(short(TAG_ISO, spec.iso));
  if (spec.flash !== undefined) exifEntries.push(short(TAG_FLASH, spec.flash));
  if (spec.width !== undefined) exifEntries.push(long(TAG_EXIF_IMAGE_WIDTH, spec.width));
  if (spec.height !== undefined) exifEntries.push(long(TAG_EXIF_IMAGE_HEIGHT, spec.height));

  const hasGps = spec.latitude !== undefined && spec.longitude !== undefined;
  const gpsEntries: TagValue[] = hasGps
    ? [
        ascii(TAG_GPS_LAT_REF, (spec.latitude as number) >= 0 ? "N" : "S"),
        rational(TAG_GPS_LAT, degreesToRationals(spec.latitude as number)),
        ascii(TAG_GPS_LON_REF, (spec.longitude as number) >= 0 ? "E" : "W"),
        rational(TAG_GPS_LON, degreesToRationals(spec.longitude as number)),
      ]
    : [];

  const exifPointer = long(TAG_EXIF_IFD, 0);
  const gpsPointer = long(TAG_GPS_IFD, 0);
  const ifd0Entries: TagValue[] = [ascii(TAG_MAKE, spec.make), ascii(TAG_MODEL, spec.model), exifPointer];
  if (spec.orientation !== undefined) ifd0Entries.push(short(TAG_ORIENTATION, spec.orientation));
  if (hasGps) ifd0Entries.push(gpsPointer);

  // Sizing first: both pointers are fixed-width inline values, so patching
  // them afterwards cannot shift anything that follows.
  const ifd0Size = serializeIfd(ifd0Entries, 8, 0).length;
  const exifStart = 8 + ifd0Size;
  const exifSize = serializeIfd(exifEntries, exifStart, 0).length;
  const gpsStart = exifStart + exifSize;

  exifPointer.data.writeUInt32LE(exifStart, 0);
  if (hasGps) gpsPointer.data.writeUInt32LE(gpsStart, 0);

  const ifd0 = serializeIfd(ifd0Entries, 8, 0);
  const exifIfd = serializeIfd(exifEntries, exifStart, 0);
  const gpsIfd = hasGps ? serializeIfd(gpsEntries, gpsStart, 0) : Buffer.alloc(0);

  return Buffer.concat([header, ifd0, exifIfd, gpsIfd]);
}

/**
 * A valid-enough JPEG: start of image, an EXIF APP1 segment, end of image,
 * then filler to reach `targetSize`. The filler sits after EOI where decoders
 * ignore it, and gives each fixture a distinct size.
 */
export function buildJpegWithExif(spec: ExifSpec, targetSize = 0, filler = 0x00): Buffer {
  const tiff = buildTiff(spec);
  const app1Length = 2 + 6 + tiff.length;

  const segment = Buffer.alloc(4);
  segment.writeUInt16BE(0xffe1, 0);
  segment.writeUInt16BE(app1Length, 2);

  const base = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment,
    Buffer.from("Exif\0\0", "latin1"),
    tiff,
    Buffer.from([0xff, 0xd9]),
  ]);

  if (targetSize <= base.length) return base;
  return Buffer.concat([base, Buffer.alloc(targetSize - base.length, filler)]);
}

// --------------------------------------------------------------- video -----

/** Seconds between the QuickTime epoch (1904-01-01) and the Unix epoch. */
const QT_EPOCH_OFFSET = 2082844800;

function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
}

/** A QuickTime text atom: two-byte length, two-byte language, then the string. */
function textAtom(type: string, value: string): Buffer {
  const text = Buffer.from(value, "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt16BE(text.length, 0);
  header.writeUInt16BE(0, 2);
  return box(type, header, text);
}

export interface VideoSpec {
  /** `YYYY:MM:DD HH:MM:SS`, read as UTC — the same way a camera writes it. */
  created: string;
  durationSeconds: number;
  make?: string;
  model?: string;
}

/**
 * An MP4 with a real `moov` and nothing else worth having.
 *
 * The `mdat` box is present but empty: this tool never decodes a frame, it
 * walks the box list, so a fixture only needs the boxes it walks.
 */
export function buildMp4(spec: VideoSpec, targetSize = 0): Buffer {
  const [date, time] = spec.created.split(" ");
  const [year, month, day] = (date ?? "").split(":").map(Number);
  const [hour, minute, second] = (time ?? "").split(":").map(Number);
  const created =
    Math.floor(
      Date.UTC(year as number, (month as number) - 1, day as number, hour ?? 0, minute ?? 0, second ?? 0) /
        1000,
    ) + QT_EPOCH_OFFSET;

  const timescale = 600;
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt8(0, 0); // version 0, flags 0
  mvhd.writeUInt32BE(created, 4);
  mvhd.writeUInt32BE(created, 8);
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(Math.round(spec.durationSeconds * timescale), 16);

  const udtaChildren: Buffer[] = [];
  if (spec.make) udtaChildren.push(textAtom("©mak", spec.make));
  if (spec.model) udtaChildren.push(textAtom("©mod", spec.model));

  const moov = box(
    "moov",
    box("mvhd", mvhd),
    ...(udtaChildren.length > 0 ? [box("udta", ...udtaChildren)] : []),
  );

  // Major brand, minor version, then the compatible-brand list.
  const ftyp = box(
    "ftyp",
    Buffer.from("isom", "latin1"),
    Buffer.from([0, 0, 2, 0]),
    Buffer.from("isomiso2mp41", "latin1"),
  );
  const head = Buffer.concat([ftyp, moov]);

  // Padding goes *inside* `mdat`, where footage would be. Appended after the
  // last box it would be read as another box header, and the walker would
  // rightly refuse the file.
  const padding = Math.max(0, targetSize - head.length - 8);
  return Buffer.concat([head, box("mdat", Buffer.alloc(padding))]);
}
