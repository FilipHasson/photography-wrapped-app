import fs from "node:fs/promises";
import path from "node:path";
import { buildJpegWithExif, buildMp4, type ExifSpec } from "./exif-writer.ts";
import type { CatalogEntry } from "./make-catalog.ts";

/**
 * Builds a small library that encodes the situations the counting has to get
 * right, rather than a pile of plausible files:
 *
 *  - a RAW + JPEG shoot, which must count as one photograph per press
 *  - a second shoot the same day on a different lens, in one long burst
 *  - a copy of five frames in a backup folder, which must not count again
 *  - a second body with a crop sensor, so the focal-length families are tested
 *  - two clips whose only metadata is a QuickTime `moov`
 *  - a shoot in the previous year, so ranges have something to exclude
 *
 * `EXPECTED` states what a correct index makes of all that. When the counting
 * changes, check that block still describes reality before editing any test to
 * agree with new output.
 */

const NIKON: Pick<ExifSpec, "make" | "model" | "serial"> = {
  make: "NIKON CORPORATION",
  model: "NIKON Z 8",
  serial: "Z8-000121",
};

const FUJI: Pick<ExifSpec, "make" | "model" | "serial"> = {
  make: "FUJIFILM",
  model: "X-T5",
  serial: "XT5-90210",
};

const LENS_24_70 = { lensMake: "NIKON", lensModel: "NIKKOR Z 24-70mm f/2.8 S" };
const LENS_70_200 = { lensMake: "NIKON", lensModel: "NIKKOR Z 70-200mm f/2.8 VR S" };
/** The same lens with a converter on the back — one lens, used further away. */
const LENS_70_200_TC = {
  lensMake: "NIKON",
  lensModel: "NIKKOR Z 70-200mm f/2.8 VR S + 1.4X Teleconverter",
};
const LENS_XF = { lensMake: "FUJIFILM", lensModel: "XF16-55mmF2.8 R LM WR" };

export const EXPECTED = {
  /** Files written to disk. */
  files: 44,
  /** Photographs, once pairs and copies are folded together. */
  shots: 29,
  /** With raw + JPEG pairs counted separately, only the paths dedupe. */
  shotsUnmerged: 44,
  cameras: 2,
  lenses: 3,
  topCamera: "Nikon Z 8",
  topCameraShots: 21,
  topLens: "NIKKOR Z 24-70mm S",
  topLensShots: 13,
  topCombo: 13,
  daysShot: 3,
  busiestDay: 20250315,
  busiestDayShots: 16,
  favouriteFocal: 24,
  favouriteAperture: 2.8,
  withGps: 10,
  videos: 2,
  videoSeconds: 42,
  longestBurst: 10,
  /** Frames of the 70-200 taken through a 1.4x converter. */
  teleconverted: 2,
  shots2025: 26,
  shotsMarch2025: 16,
} as const;

/**
 * A catalog covering the morning shoot, with the two things a folder cannot say.
 *
 * Ratings and pick flags exist only in a Lightroom catalog — nothing is read
 * off the files themselves — so the keepers and culling slides are invisible to
 * any test that indexes the fixtures as a folder, which is every test there was.
 *
 * The spread is chosen, not arbitrary. Every star bucket but one is filled,
 * because a rating nobody used is still a card the slide has to draw, and
 * getting that wrong is the kind of thing only a real gap catches. Both flags
 * appear, and most frames carry neither.
 */
export function fixtureCatalog(root: string): CatalogEntry[] {
  const at = `${root.split(path.sep).join("/")}/`;
  // Two fives, two fours, two threes, no twos, two ones, and two never rated.
  const ratings = [5, 5, 4, 4, 3, 3, 1, 1, 0, 0];
  const picks = [1, 1, 1, -1, -1, 0, 0, 0, 0, 0];

  return Array.from({ length: 10 }, (_, i) => ({
    root: at,
    folder: "2025/03-15/morning/",
    baseName: `DSC_${String(2000 + i).padStart(4, "0")}`,
    extension: "NEF",
    captureTime: `2025-03-15T10:00:${String(i).padStart(2, "0")}`,
    cameraModel: NIKON.model,
    cameraSerial: NIKON.serial,
    lens: LENS_24_70.lensModel,
    focalLength: 24,
    aperture: 2.8,
    shutter: 1 / 250,
    iso: 200,
    rating: ratings[i] ?? 0,
    pick: picks[i] ?? 0,
    width: 8256,
    height: 5504,
    // The same fix the files carry. A catalog row outranks a folder row, and
    // only the rating and the pick are inherited back from the loser — so a
    // catalog that forgets the coordinates deletes them from the library.
    latitude: 59.3293,
    longitude: 18.0686,
  }));
}

async function write(file: string, data: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

function stamp(day: string, hour: number, minute: number, second: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${day} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

export async function makeFixtures(root: string): Promise<string> {
  await fs.rm(root, { recursive: true, force: true });

  // --- Shoot 1: ten frames, raw + JPEG, wide zoom, with a GPS fix ----------
  const shoot1 = path.join(root, "2025", "03-15", "morning");
  for (let i = 0; i < 10; i++) {
    const spec: ExifSpec = {
      ...NIKON,
      ...LENS_24_70,
      dateTimeOriginal: stamp("2025:03:15", 10, 0, i),
      subSec: String(100 + i),
      focalLength: 24,
      focalLength35: 24,
      aperture: 2.8,
      shutter: 1 / 250,
      iso: 200,
      flash: 0,
      width: 8256,
      height: 5504,
      orientation: 1,
      latitude: 59.3293,
      longitude: 18.0686,
    };
    const name = `DSC_${String(2000 + i).padStart(4, "0")}`;
    await write(path.join(shoot1, `${name}.NEF`), buildJpegWithExif(spec, 40000, 0x11));
    await write(path.join(shoot1, `${name}.JPG`), buildJpegWithExif(spec, 9000, 0x22));
  }

  // --- Shoot 2: one long burst on the telephoto, same day ------------------
  const shoot2 = path.join(root, "2025", "03-15", "afternoon");
  for (let i = 0; i < 6; i++) {
    // The last two frames of the burst are through a 1.4x converter.
    const converted = i >= 4;
    await write(
      path.join(shoot2, `DSC_${String(3000 + i).padStart(4, "0")}.NEF`),
      buildJpegWithExif(
        {
          ...NIKON,
          ...(converted ? LENS_70_200_TC : LENS_70_200),
          dateTimeOriginal: stamp("2025:03:15", 14, 0, i),
          subSec: String(200 + i),
          focalLength: converted ? 280 : 200,
          focalLength35: converted ? 280 : 200,
          aperture: 4,
          shutter: 1 / 1000,
          iso: 800,
          flash: 0,
          width: 8256,
          height: 5504,
          orientation: 1,
        },
        41000 + i,
        0x33,
      ),
    );
  }

  // --- Shoot 3: the crop body, held upright, plus two clips ----------------
  const shoot3 = path.join(root, "2025", "06-20");
  for (let i = 0; i < 8; i++) {
    await write(
      path.join(shoot3, `DSCF${String(1000 + i)}.JPG`),
      buildJpegWithExif(
        {
          ...FUJI,
          ...LENS_XF,
          dateTimeOriginal: stamp("2025:06:20", 18, 30, i * 7),
          subSec: String(300 + i),
          focalLength: 23,
          // A 23mm lens on APS-C frames like a 35mm — the equivalent is what
          // decides which angle-of-view family it belongs to.
          focalLength35: 35,
          aperture: 5.6,
          shutter: 1 / 125,
          iso: 400,
          flash: 0,
          width: 7728,
          height: 5152,
          orientation: 6,
        },
        12000 + i,
        0x44,
      ),
    );
  }

  await write(
    path.join(shoot3, "DSC_0001.MP4"),
    buildMp4(
      { created: stamp("2025:06:20", 19, 0, 0), durationSeconds: 12, make: "NIKON", model: "NIKON Z 8" },
      64000,
    ),
  );
  await write(
    path.join(shoot3, "DSC_0002.MP4"),
    buildMp4(
      { created: stamp("2025:06:20", 19, 5, 0), durationSeconds: 30, make: "NIKON", model: "NIKON Z 8" },
      96000,
    ),
  );

  // --- Shoot 4: last year, stopped down, flash fired ----------------------
  const shoot4 = path.join(root, "2024", "12-31");
  for (let i = 0; i < 3; i++) {
    await write(
      path.join(shoot4, `DSC_${String(1000 + i).padStart(4, "0")}.JPG`),
      buildJpegWithExif(
        {
          ...NIKON,
          ...LENS_24_70,
          dateTimeOriginal: stamp("2024:12:31", 23, 50, i * 3),
          subSec: String(400 + i),
          focalLength: 70,
          focalLength35: 70,
          aperture: 8,
          shutter: 1 / 60,
          iso: 100,
          flash: 1,
          width: 8256,
          height: 5504,
          orientation: 1,
        },
        11000 + i,
        0x55,
      ),
    );
  }

  // --- A backup copy of five frames, at a different path ------------------
  // Same body, same instant, different folder: five files that are not five
  // more photographs.
  const backup = path.join(root, "backup", "2025-03-15");
  for (let i = 0; i < 5; i++) {
    const name = `DSC_${String(2000 + i).padStart(4, "0")}.JPG`;
    await fs.mkdir(backup, { recursive: true });
    await fs.copyFile(path.join(shoot1, name), path.join(backup, name));
  }

  return root;
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (invokedDirectly) {
  const target = path.resolve(process.argv[2] ?? "fixtures");
  await makeFixtures(target);
  console.log(`  ${EXPECTED.files} files written to ${target}`);
}
