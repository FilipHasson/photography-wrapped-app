import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Builds a Lightroom Classic catalog with just enough schema to be read.
 *
 * A real `.lrcat` has some three hundred tables; the indexer reads eight of
 * them and probes for every optional column first, so a fixture only needs the
 * eight. Writing one here means the catalog path is tested on a machine that
 * has never had Lightroom installed — and it is the path most likely to break
 * quietly, because it is where two sources start describing the same files.
 */

const SCHEMA = `
CREATE TABLE AgLibraryRootFolder (id_local INTEGER PRIMARY KEY, absolutePath TEXT, name TEXT);
CREATE TABLE AgLibraryFolder (id_local INTEGER PRIMARY KEY, pathFromRoot TEXT, rootFolder INTEGER);
CREATE TABLE AgLibraryFile (
  id_local INTEGER PRIMARY KEY, baseName TEXT, extension TEXT, folder INTEGER,
  originalFilename TEXT, md5 TEXT
);
CREATE TABLE Adobe_images (
  id_local INTEGER PRIMARY KEY, rootFile INTEGER, captureTime TEXT, rating INTEGER, pick INTEGER,
  colorLabels TEXT, fileFormat TEXT, orientation TEXT, fileWidth INTEGER, fileHeight INTEGER,
  masterImage INTEGER
);
CREATE TABLE AgHarvestedExifMetadata (
  id_local INTEGER PRIMARY KEY, image INTEGER, cameraModelRef INTEGER, cameraSNRef INTEGER,
  lensRef INTEGER, focalLength REAL, aperture REAL, shutterSpeed REAL, isoSpeedRating REAL,
  flashFired INTEGER, gpsLatitude REAL, gpsLongitude REAL, hasGPS INTEGER
);
CREATE TABLE AgInternedExifCameraModel (id_local INTEGER PRIMARY KEY, value TEXT);
CREATE TABLE AgInternedExifCameraSN (id_local INTEGER PRIMARY KEY, value TEXT);
CREATE TABLE AgInternedExifLens (id_local INTEGER PRIMARY KEY, value TEXT);
`;

export interface CatalogEntry {
  /** Root of the tree the catalog points at, as Lightroom stores it. */
  root: string;
  /** Folder below the root, Lightroom style, with a trailing slash. */
  folder: string;
  baseName: string;
  extension: string;
  /** `2025-03-15T10:00:00`, the shape a catalog uses. */
  captureTime: string;
  cameraModel?: string;
  cameraSerial?: string;
  lens?: string;
  focalLength?: number;
  /** f-number; converted to the APEX value the catalog actually stores. */
  aperture?: number;
  /** Seconds; converted to APEX as above. */
  shutter?: number;
  iso?: number;
  rating?: number;
  pick?: number;
  /** `AB` as shot, `BC` a quarter turn. */
  orientation?: string;
  width?: number;
  height?: number;
  latitude?: number;
  longitude?: number;
  /** `RAW`, `JPG`, `DNG`, `VIDEO`. */
  fileFormat?: string;
}

/** Lightroom stores aperture and shutter logarithmically. See core/units.ts. */
const toApertureApex = (f: number) => 2 * Math.log2(f);
const toShutterApex = (seconds: number) => -Math.log2(seconds);

export async function makeCatalog(file: string, entries: CatalogEntry[]): Promise<string> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.rm(file, { force: true });

  const cat = new DatabaseSync(file);
  cat.exec(SCHEMA);

  const intern = (table: string, cache: Map<string, number>, value: string | undefined) => {
    if (!value) return null;
    const hit = cache.get(value);
    if (hit !== undefined) return hit;
    const id = cache.size + 1;
    cat.prepare(`INSERT INTO ${table} (id_local, value) VALUES (?, ?)`).run(id, value);
    cache.set(value, id);
    return id;
  };

  const roots = new Map<string, number>();
  const folders = new Map<string, number>();
  const cameras = new Map<string, number>();
  const serials = new Map<string, number>();
  const lenses = new Map<string, number>();

  entries.forEach((entry, index) => {
    const id = index + 1;

    let rootId = roots.get(entry.root);
    if (rootId === undefined) {
      rootId = roots.size + 1;
      cat
        .prepare("INSERT INTO AgLibraryRootFolder (id_local, absolutePath, name) VALUES (?, ?, ?)")
        .run(rootId, entry.root, path.basename(entry.root));
      roots.set(entry.root, rootId);
    }

    const folderKey = `${rootId}:${entry.folder}`;
    let folderId = folders.get(folderKey);
    if (folderId === undefined) {
      folderId = folders.size + 1;
      cat
        .prepare("INSERT INTO AgLibraryFolder (id_local, pathFromRoot, rootFolder) VALUES (?, ?, ?)")
        .run(folderId, entry.folder, rootId);
      folders.set(folderKey, folderId);
    }

    cat
      .prepare(
        "INSERT INTO AgLibraryFile (id_local, baseName, extension, folder, originalFilename) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, entry.baseName, entry.extension, folderId, `${entry.baseName}.${entry.extension}`);

    cat
      .prepare(
        `INSERT INTO Adobe_images
         (id_local, rootFile, captureTime, rating, pick, colorLabels, fileFormat, orientation, fileWidth, fileHeight, masterImage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        id,
        id,
        entry.captureTime,
        entry.rating ?? null,
        entry.pick ?? null,
        null,
        entry.fileFormat ?? "RAW",
        entry.orientation ?? "AB",
        entry.width ?? null,
        entry.height ?? null,
      );

    cat
      .prepare(
        `INSERT INTO AgHarvestedExifMetadata
         (id_local, image, cameraModelRef, cameraSNRef, lensRef, focalLength, aperture, shutterSpeed,
          isoSpeedRating, flashFired, gpsLatitude, gpsLongitude, hasGPS)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        id,
        intern("AgInternedExifCameraModel", cameras, entry.cameraModel),
        intern("AgInternedExifCameraSN", serials, entry.cameraSerial),
        intern("AgInternedExifLens", lenses, entry.lens),
        entry.focalLength ?? null,
        entry.aperture === undefined ? null : toApertureApex(entry.aperture),
        entry.shutter === undefined ? null : toShutterApex(entry.shutter),
        entry.iso ?? null,
        entry.rating === undefined ? null : 0,
        entry.latitude ?? null,
        entry.longitude ?? null,
        entry.latitude === undefined ? 0 : 1,
      );
  });

  cat.close();
  return file;
}
