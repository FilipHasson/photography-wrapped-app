/**
 * Turning what a camera writes into what a photographer calls it.
 *
 * This is the module the whole deck leans on: "your most-used lens" is only
 * true if the same lens on two bodies collapses to one row. EXIF is not helpful
 * here — the same Sigma reads as `24-70mm F2.8 DG DN | Art 019` on one body and
 * `Sigma 24-70mm f/2.8 DG DN Art` on another, and Nikon writes the make as
 * `NIKON CORPORATION` while its catalog entry says just `NIKON Z 8`.
 *
 * So every name gets split in two: a **key**, aggressively normalized and used
 * for grouping, and a **label**, tidied only for looks. Grouping never depends
 * on the label, and the label never has to be canonical.
 */

export interface GearName {
  /** Grouping key. Never shown. */
  key: string;
  /** What appears on a slide. */
  label: string;
  make: string;
  model: string;
}

export function cleanField(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value !== "string") return "";
  return value.replace(/\0/g, "").replace(/\s+/g, " ").trim();
}

/** Placeholders cameras write when they know nothing. */
function isPlaceholder(value: string): boolean {
  const v = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (v === "") return true;
  return v === "unknown" || v === "n/a" || v === "na" || v === "none" || v === "0mmf0" || /^0+$/.test(v);
}

function keyOf(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Sony names every body `ILCE-…`, which nobody says out loud. Display only —
 * the grouping key stays the raw model, so an unmapped body is never merged
 * with a mapped one.
 */
const CAMERA_ALIASES = new Map<string, string>(
  Object.entries({
    "ilce-1": "a1",
    "ilce-1m2": "a1 II",
    "ilce-6700": "a6700",
    "ilce-7cm2": "a7C II",
    "ilce-7m3": "a7 III",
    "ilce-7m4": "a7 IV",
    "ilce-7m5": "a7 V",
    "ilce-7rm3": "a7R III",
    "ilce-7rm4": "a7R IV",
    "ilce-7rm5": "a7R V",
    "ilce-7sm3": "a7S III",
    "ilce-9m2": "a9 II",
    "ilce-9m3": "a9 III",
  }),
);

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bDji\b/g, "DJI")
    .replace(/\bGopro\b/g, "GoPro");
}

/** `NIKON CORPORATION` → `Nikon`, `SONY` → `Sony`, `Canon` → `Canon`. */
function tidyMake(make: string): string {
  const trimmed = make
    .replace(/\b(corporation|corp\.?|company|co\.?,? ?ltd\.?|imaging|inc\.?)\b/gi, "")
    .trim();
  const base = trimmed === "" ? make : trimmed;
  // An all-caps make reads as shouting; anything mixed-case is already fine.
  return base === base.toUpperCase() ? titleCase(base) : base;
}

/**
 * A camera body. `null` when there is nothing usable — common for video files
 * and for stills stripped by an export.
 */
export function normalizeCamera(makeRaw: unknown, modelRaw: unknown): GearName | null {
  const make = cleanField(makeRaw);
  const model = cleanField(modelRaw);
  if (isPlaceholder(model) && isPlaceholder(make)) return null;

  let trimmedModel = model;
  // Plenty of bodies repeat the make inside the model (`Canon Canon EOS R5`).
  if (make !== "" && trimmedModel.toLowerCase().startsWith(`${make.toLowerCase()} `)) {
    trimmedModel = trimmedModel.slice(make.length + 1);
  }
  if (isPlaceholder(trimmedModel)) trimmedModel = model;

  const displayMake = make === "" ? "" : tidyMake(make);
  const alias = CAMERA_ALIASES.get(trimmedModel.toLowerCase());
  let displayModel = alias ?? trimmedModel;

  // `NIKON Z 8` with make `Nikon` should read `Nikon Z 8`, not keep shouting.
  if (displayMake !== "" && displayModel.toLowerCase().startsWith(displayMake.toLowerCase())) {
    displayModel = displayMake + displayModel.slice(displayMake.length);
  }

  const label =
    displayMake !== "" && !displayModel.toLowerCase().startsWith(displayMake.toLowerCase())
      ? `${displayMake} ${displayModel}`
      : displayModel;

  return {
    // Built from the model exactly as written, and never from the make.
    //
    // A Lightroom catalog stores only the model, so a key including the make
    // could never match one built from a file's EXIF. And the tidying above is
    // deliberately not applied here: a video's `©mod` atom says `NIKON Z 8`
    // with a make of `NIKON`, where the same body's stills say `NIKON Z 8`
    // with `NIKON CORPORATION`. Strip the prefix and one body becomes two.
    key: keyOf(model === "" ? make : model),
    label: label.trim(),
    make: displayMake,
    model: displayModel,
  };
}

function round(value: number, places = 0): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** `[24, 70, 2.8, 2.8]` → `24-70mm f/2.8`, the fallback when there is no name. */
export function lensNameFromSpec(spec: unknown): string | null {
  if (!Array.isArray(spec) || spec.length < 2) return null;
  const numbers = spec.map((v) => (typeof v === "number" ? v : Number(v)));
  const [minFocal, maxFocal, minAperture, maxAperture] = numbers;
  if (!minFocal || !Number.isFinite(minFocal) || minFocal <= 0) return null;

  const focal =
    maxFocal && Number.isFinite(maxFocal) && Math.abs(maxFocal - minFocal) > 0.5
      ? `${round(minFocal)}-${round(maxFocal)}mm`
      : `${round(minFocal)}mm`;

  const wide = minAperture && Number.isFinite(minAperture) && minAperture > 0 ? minAperture : null;
  const long = maxAperture && Number.isFinite(maxAperture) && maxAperture > 0 ? maxAperture : null;
  if (wide === null) return focal;

  const aperture =
    long !== null && Math.abs(long - wide) > 0.1
      ? `f/${round(wide, 1)}-${round(long, 1)}`
      : `f/${round(wide, 1)}`;
  return `${focal} ${aperture}`;
}

/**
 * Brand words, longest first so `carl zeiss` wins over `zeiss`.
 *
 * These get stripped off the front of a lens name before the key is built.
 * The reason is a mismatch between sources: a folder scan reads `LensMake`
 * separately (`SIGMA` + `24-70mm F2.8 DG DN | Art 019`) while a catalog hands
 * over one string that may or may not start with the brand. Dropping the brand
 * on both sides is the only way the same lens lands in one bucket either way.
 *
 * Nothing else is stripped. Family markers like `DG DN`, `Di III`, `GM` and
 * `L` stay in the key precisely because they are what keeps a Sigma 24-70/2.8
 * apart from a Tamron one once the brand itself is gone.
 */
const BRAND_TOKENS = [
  "om digital solutions", "om digital", "om system", "venus optics", "carl zeiss",
  "hasselblad", "panasonic", "7artisans", "voigtlander", "ttartisan", "lensbaby",
  "fujifilm", "olympus", "samyang", "yongnuo", "viltrox", "rokinon", "m.zuiko",
  "fujinon", "pentax", "nikkor", "tamron", "tokina", "sigma", "zuiko", "leica",
  "lumix", "canon", "nikon", "meike", "sirui", "zeiss", "laowa", "gopro", "fuji",
  "sony", "irix", "apple", "dji",
];

function stripBrandPrefix(model: string): string {
  let out = model.trim();
  for (;;) {
    const lower = out.toLowerCase();
    const hit = BRAND_TOKENS.find(
      (brand) => lower.startsWith(brand) && /^[\s\-]|^$/.test(lower.slice(brand.length)),
    );
    if (!hit) return out;
    out = out.slice(hit.length).replace(/^[\s\-]+/, "");
    if (out === "") return model.trim(); // Brand-only names keep what they had.
  }
}

/** Cosmetic only: `EF24-70mm f/2.8L II USM` → `EF 24-70mm f/2.8L II USM`. */
function tidyLens(model: string): string {
  return model
    .replace(/^(EF-S|EF-M|EF|RF-S|RF|FE|DT|XF|XC|DX|AF-S|AF-P|AF|SP|M\.|E|Z)(\d)/i, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLens(makeRaw: unknown, modelRaw: unknown, spec?: unknown): GearName | null {
  const make = cleanField(makeRaw);
  let model = cleanField(modelRaw);

  if (isPlaceholder(model)) {
    const fromSpec = lensNameFromSpec(spec);
    if (fromSpec === null) return null;
    model = fromSpec;
  }

  // Sigma and Tamron append a release code after a pipe (`| Art 019`).
  const label = tidyLens(model.replace(/\s*\|\s*/g, " "));
  const displayMake = make === "" ? "" : tidyMake(make);

  // The make is only worth adding when the name does not already carry a brand.
  // Nikon's lenses say `NIKKOR`, which is Nikon — prepending gives the useless
  // `Nikon NIKKOR Z 24-70mm f/2.8 S`.
  const named = label.toLowerCase().includes(displayMake.toLowerCase()) || label !== stripBrandPrefix(label);
  const withMake = displayMake !== "" && !named ? `${displayMake} ${label}` : label;

  // The key is built from the optics alone — brand stripped, aperture notation
  // normalized (`F2.8`, `f/2.8`, `f2.8`), and the release codes Sigma and
  // Tamron append (`019`, `A036`) dropped, since those move with a firmware
  // revision rather than with the glass.
  const key = keyOf(
    stripBrandPrefix(label)
      .replace(/f\s*\/\s*(\d)/gi, "f$1")
      // Only a free-standing token: `100-500mm` and `400 mm` must survive.
      .replace(/(^|\s)[a-z]?\d{3}(?=\s|$)(?!\s*mm)/gi, " "),
  );
  if (key === "") return null;

  return { key, label: withMake, make: displayMake, model: label };
}

/** The pairing the deck is really about: one body, one lens. */
export function comboLabel(camera: string, lens: string): string {
  return `${camera} + ${lens}`;
}
