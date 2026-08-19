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

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/**
 * Makes that need more than a change of case. Keyed on the make with every
 * non-alphanumeric character removed, because the punctuation varies by body
 * even within one manufacturer.
 */
const MAKE_ALIASES = new Map(
  Object.entries({
    nikoncorporation: "Nikon",
    olympuscorporation: "Olympus",
    olympusimagingcorp: "Olympus",
    olympusopticalcoltd: "Olympus",
    omdigitalsolutions: "OM System",
    ricohimagingcompanyltd: "Ricoh",
    ricohimagingcompany: "Ricoh",
    leicacameraag: "Leica",
    eastmankodakcompany: "Kodak",
    phaseoneas: "Phase One",
    victorcompanyofjapanlimited: "JVC",
    sonyericssonmobilecommunicationsab: "Sony",
    samsungtechwin: "Samsung",
    hmdglobal: "Nokia",
    casiocomputercoltd: "Casio",
    seikoepsoncorp: "Epson",
    hewlettpackard: "HP",
  }),
);

/**
 * Brand names and how they are actually written, whether they turn up as the
 * make or at the front of the model. `PENTAX K-3 Mark III` is a Ricoh body
 * whose model names Pentax; `motorola` writes its own name in lower case.
 */
const BRANDS = new Map(
  Object.entries({
    canon: "Canon", nikon: "Nikon", sony: "Sony", fujifilm: "Fujifilm", fuji: "Fujifilm",
    olympus: "Olympus", panasonic: "Panasonic", leica: "Leica", pentax: "Pentax",
    ricoh: "Ricoh", sigma: "Sigma", hasselblad: "Hasselblad", kodak: "Kodak",
    minolta: "Minolta", konica: "Konica", casio: "Casio", epson: "Epson", jvc: "JVC",
    gopro: "GoPro", dji: "DJI", insta360: "Insta360", blackmagic: "Blackmagic",
    apple: "Apple", samsung: "Samsung", google: "Google", motorola: "Motorola",
    oneplus: "OnePlus", xiaomi: "Xiaomi", huawei: "Huawei", honor: "Honor",
    oppo: "OPPO", vivo: "vivo", realme: "realme", asus: "ASUS", nokia: "Nokia",
    nothing: "Nothing", sharp: "Sharp", lg: "LG", htc: "HTC", zte: "ZTE",
  }),
);

/**
 * Product lines that name their own maker. `iPhone 15 Pro` needs no "Apple" in
 * front of it, and neither does `Pixel 8 Pro` or `Galaxy S24 Ultra` — the way
 * people say these names is the way they should read on a slide.
 */
const FAMILIES = new Map(
  Object.entries({
    iphone: "iPhone", ipad: "iPad", ipod: "iPod",
    pixel: "Pixel", nexus: "Nexus", galaxy: "Galaxy", xperia: "Xperia",
    lumix: "Lumix", moto: "Moto", nord: "Nord", redmi: "Redmi", poco: "POCO",
    // Deliberately absent: DJI Mavic, GoPro HERO, Fujifilm Instax. Those are
    // said with the maker in front of them, so the maker stays.
  }),
);

const brandOf = (token: string): string | undefined =>
  BRANDS.get(token.toLowerCase().replace(/[^a-z0-9]/g, ""));

const familyOf = (token: string): string | undefined =>
  FAMILIES.get(token.toLowerCase().replace(/[^a-z0-9]/g, ""));

function titleCase(value: string): string {
  return value
    .split(" ")
    // A word with a digit in it is a model number — `5G`, `X100VI` — and its
    // case is the maker's business, not ours.
    .map((word) =>
      /\d/.test(word) ? word : word.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()),
    )
    .join(" ");
}

/** `NIKON CORPORATION` → `Nikon`, `SONY` → `Sony`, `Canon` → `Canon`. */
function tidyMake(make: string): string {
  const alias = MAKE_ALIASES.get(make.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (alias) return alias;

  const known = brandOf(make);
  if (known) return known;

  const trimmed = make
    .replace(/\b(corporation|corp\.?|company|co\.?,? ?ltd\.?|imaging|inc\.?|gmbh|a\/s|ag)\b/gi, "")
    .replace(/[,;]+\s*$/, "")
    .trim();
  const base = trimmed === "" ? make : trimmed;
  // An all-caps make reads as shouting; anything mixed-case is already fine.
  return base === base.toUpperCase() ? titleCase(base) : base;
}

/** `<code>M<n>` → `<code> <roman>`: the generation, said the way it is spoken. */
function withGeneration(code: string): string {
  const generation = code.match(/^(.*?)M(\d{1,2})$/i);
  if (!generation) return code;
  const [, stem = "", mark = ""] = generation;
  return `${stem} ${ROMAN[Number(mark)] ?? mark}`.trim();
}

/**
 * Sony writes internal product codes where most makers write a name: `ILCE-7M2`
 * for an a7 II, `DSC-RX100M7` for an RX100 VII. Left alone, one shelf of Sony
 * bodies reads as three naming schemes on the same slide.
 *
 * A rule rather than a lookup table, on purpose — a table only fixes the bodies
 * someone remembered to add, which is exactly how `a9 III` and `ILCE-7M2` ended
 * up side by side here once already.
 */
function sonyModelName(model: string): string | null {
  const match = model.match(/^(ILCE|ILME|DSC|ZV)-(.+)$/i);
  if (!match) return null;

  const [, family = "", code = ""] = match;
  const spoken = withGeneration(code);

  switch (family.toUpperCase()) {
    // The Alpha line, which everyone writes with a leading "a".
    case "ILCE":
      return `a${spoken}`;
    // Cinema bodies and compacts are said as written.
    case "ILME":
    case "DSC":
      return spoken;
    case "ZV":
      return `ZV-${spoken}`;
    default:
      return null;
  }
}

/** `DC-S5M2` → `Lumix S5 II`, `DMC-GH4` → `Lumix GH4`. Panasonic's own scheme. */
function panasonicModelName(model: string): string | null {
  const match = model.match(/^(?:DC|DMC)-(.+)$/i);
  return match ? `Lumix ${withGeneration(match[1] as string)}` : null;
}

/** `E-M1MarkIII` → `E-M1 Mark III`. Olympus runs the words together. */
function olympusModelName(model: string): string | null {
  const match = model.match(/^(E-[A-Z]?\d+|PEN-F|TG-\d+)\s*Mark\s*([IVX]+)$/i);
  if (match) return `${match[1]} Mark ${(match[2] as string).toUpperCase()}`;
  return null;
}

/**
 * Samsung phones report a service code — `SM-S928B` for a Galaxy S24 Ultra —
 * and there is no rule to derive the name from it, so this is the one place a
 * table is unavoidable.
 *
 * Only codes worth being sure about are listed; anything else keeps the code it
 * came with rather than being guessed at. The trailing letter is the regional
 * variant and is ignored.
 */
const SAMSUNG_MODELS = new Map(
  Object.entries({
    "SM-G980": "Galaxy S20", "SM-G981": "Galaxy S20", "SM-G985": "Galaxy S20+",
    "SM-G986": "Galaxy S20+", "SM-G988": "Galaxy S20 Ultra",
    "SM-G990": "Galaxy S21 FE", "SM-G991": "Galaxy S21", "SM-G996": "Galaxy S21+",
    "SM-G998": "Galaxy S21 Ultra",
    "SM-S901": "Galaxy S22", "SM-S906": "Galaxy S22+", "SM-S908": "Galaxy S22 Ultra",
    "SM-S911": "Galaxy S23", "SM-S916": "Galaxy S23+", "SM-S918": "Galaxy S23 Ultra",
    "SM-S921": "Galaxy S24", "SM-S926": "Galaxy S24+", "SM-S928": "Galaxy S24 Ultra",
    "SM-S931": "Galaxy S25", "SM-S936": "Galaxy S25+", "SM-S938": "Galaxy S25 Ultra",
    "SM-N970": "Galaxy Note10", "SM-N975": "Galaxy Note10+",
    "SM-N981": "Galaxy Note20", "SM-N986": "Galaxy Note20 Ultra",
    "SM-F926": "Galaxy Z Fold3", "SM-F936": "Galaxy Z Fold4", "SM-F946": "Galaxy Z Fold5",
    "SM-F956": "Galaxy Z Fold6",
    "SM-F711": "Galaxy Z Flip3", "SM-F721": "Galaxy Z Flip4", "SM-F731": "Galaxy Z Flip5",
    "SM-F741": "Galaxy Z Flip6",
  }),
);

function samsungModelName(model: string): string | null {
  const code = model.match(/^(SM-[A-Z]\d{3})/i);
  if (!code) return null;

  const known = SAMSUNG_MODELS.get((code[1] as string).toUpperCase());
  if (known) return known;

  // The mid-range lines do follow a rule: the two digits after the letter are
  // the model number, so SM-A546 is a Galaxy A54 and SM-M356 a Galaxy M35. The
  // flagship letters are left to the table, where G, S, N and F mean nothing
  // so tidy.
  const series = model.match(/^SM-([AM])(\d{2})\d/i);
  if (!series) return null;
  return `Galaxy ${(series[1] as string).toUpperCase()}${series[2]}`;
}

/**
 * Fixes the case of a leading brand or family word — `PENTAX K-3` reads as
 * `Pentax K-3`, `iphone 15 pro` as `iPhone 15 Pro` — and leaves the rest of the
 * model exactly as the camera wrote it, since `X-T5` and `EOS R5` and
 * `HERO11 Black` are all already right.
 */
function tidyModel(model: string): string {
  // A model whose words are all lower case is a maker writing quietly —
  // Motorola ships `moto g stylus`. Anything with a capital in it is left
  // exactly as written, because `EOS R5`, `HERO11 Black` and Sigma's lower-case
  // `fp` are already right and no rule can tell them apart.
  //
  // Words containing digits do not count as evidence either way: they are model
  // numbers (`5G`, `X-T5`, `GFX100S`), and shouting is how they are written.
  const words = model.split(" ").filter((word) => !/\d/.test(word));
  const quiet = words.length > 0 && !/[A-Z]/.test(words.join(" "));
  const spoken = quiet ? titleCase(model) : model;

  const [first = "", ...rest] = spoken.split(" ");
  const known = brandOf(first) ?? familyOf(first);
  return known ? [known, ...rest].join(" ") : spoken;
}

/** True when the model already says whose it is, so the make would repeat it. */
function namesItsOwnMaker(model: string): boolean {
  const first = model.split(" ")[0] ?? "";
  return brandOf(first) !== undefined || familyOf(first) !== undefined;
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
  const displayModel = tidyModel(
    sonyModelName(trimmedModel) ??
      panasonicModelName(trimmedModel) ??
      samsungModelName(trimmedModel) ??
      olympusModelName(trimmedModel) ??
      trimmedModel,
  );

  const label =
    displayMake === "" || namesItsOwnMaker(displayModel)
      ? displayModel
      : `${displayMake} ${displayModel}`;

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
