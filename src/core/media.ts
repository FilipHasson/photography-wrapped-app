/**
 * Which files count as a photograph.
 *
 * A stats deck lives or dies on what it counts, so the sets here are
 * deliberately narrow: rendered stills, camera raw, and video. Sidecars,
 * previews and OS bookkeeping never enter the index at all — a `.xmp` beside
 * every raw file would silently double every number on every slide.
 */

export type MediaKind = "photo" | "raw" | "video";

/** Rendered stills. */
const PHOTO = new Set([
  "jpg", "jpeg", "jpe", "png", "heic", "heif", "avif", "webp",
  "tif", "tiff",
]);

/** Camera raw. DNG is here too — it is also what Lightroom converts *to*. */
const RAW = new Set([
  "dng", "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2",
  "raf", "orf", "rw2", "raw", "pef", "ptx", "srw", "x3f", "erf",
  "kdc", "dcr", "mrw", "3fr", "fff", "iiq", "mef", "mos", "gpr",
  "rwl",
]);

const VIDEO = new Set([
  "mp4", "mov", "m4v", "avi", "mts", "m2ts", "mxf", "mkv", "braw",
  "r3d", "insv", "360", "webm",
]);

/** Directories skipped wholesale during a walk. Compared lowercased. */
export const JUNK_DIRS = new Set([
  "system volume information",
  "$recycle.bin",
  "recycler",
  ".trashes",
  ".trash",
  ".spotlight-v100",
  ".fseventsd",
  ".temporaryitems",
  ".documentrevisions-v100",
  "found.000",
  "lost+found",
  "@eadir",
  ".picasaoriginals",
  // Lightroom's own bundles: previews, smart previews, and the sidecar cache.
  // They hold thousands of derived JPEGs that were never photographs taken.
  "lightroom catalog previews.lrdata",
  "lightroom catalog smart previews.lrdata",
]);

/** Suffixes that mark a derived file rather than something that was shot. */
const DERIVED_DIR_SUFFIXES = [".lrdata", ".lrprev", ".photoslibrary", ".aplibrary"];

export function isDerivedBundle(dirName: string): boolean {
  const lower = dirName.toLowerCase();
  return DERIVED_DIR_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/** `null` for anything that is not a photograph or a clip. */
export function classify(name: string, ext: string): MediaKind | null {
  if (name.startsWith("._")) return null; // macOS AppleDouble resource forks
  if (PHOTO.has(ext)) return "photo";
  if (RAW.has(ext)) return "raw";
  if (VIDEO.has(ext)) return "video";
  return null;
}

/** Formats exifr can pull capture metadata out of without a full decode. */
export function hasReadableExif(ext: string): boolean {
  return PHOTO.has(ext) || RAW.has(ext);
}

/** Video capture time comes from an mp4/mov atom parse, not exifr. */
export function isQuicktimeFamily(ext: string): boolean {
  return ext === "mp4" || ext === "mov" || ext === "m4v" || ext === "360" || ext === "insv";
}
