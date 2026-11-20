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
  /** A sensible default label, for anything not asking for a specific style. */
  label: string;
  make: string;
  model: string;
  /**
   * What the camera actually wrote.
   *
   * Kept because display rules change and libraries do not: labels are derived
   * from this whenever a deck is built, so a renaming rule or a settings toggle
   * reaches a library indexed months ago without re-reading a single file.
   */
  raw: { make: string; model: string };
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
    "SM-G950": "Galaxy S8", "SM-G955": "Galaxy S8+",
    "SM-G960": "Galaxy S9", "SM-G965": "Galaxy S9+",
    "SM-G970": "Galaxy S10e", "SM-G973": "Galaxy S10", "SM-G975": "Galaxy S10+",
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

/**
 * Who made it, worked out from the naming scheme, for the files that never say.
 *
 * A Lightroom catalog stores a model and nothing else: `ILCE-7M2` with no
 * `Sony` anywhere near it, `FE 200-600mm F5.6-6.3 G OSS` with no maker beside
 * it. That is most of a library for anyone who indexes a catalog, and it left
 * the maker setting with nothing to switch — the name it offered to put in
 * front did not exist.
 *
 * Only schemes that belong to exactly one maker are in here. `ILCE` is Sony's
 * and nobody else's; `EOS` is Canon's. What is deliberately *not* here is the
 * mount: `E 28-200mm F2.8-5.6 A071` is a Tamron on a Sony body, and reading the
 * mount as the maker would put the wrong name on it. So the maker's own
 * vocabulary is checked first — `A071` and `Di` are Tamron's, `DG DN` and `Art`
 * are Sigma's — and a bare `E` is left unattributed, because it genuinely does
 * not say.
 */
const MAKER_SCHEMES: Array<[RegExp, string]> = [
  // Third parties first: their designations survive on any mount, and the
  // mount underneath would otherwise claim them.
  [/\b(a0\d\d|di\s+ii+|di\s+iii|vxd|rxd|pzd)\b/i, "Tamron"],
  [/\b(dg\s+(?:dn|hsm|os)|dc\s+(?:dn|hsm)|art|sports|contemporary)\b/i, "Sigma"],

  // Sony: the product codes, the branding it puts on its own glass, and the
  // full-frame E-mount prefix nobody else writes.
  [/^(?:ilce|ilme|nex|slt-a|dslr-a|zv|sel|sal)[-\d]/i, "Sony"],
  [/^a\d/i, "Sony"],
  [/^fe\s|\b(?:gm|oss)\b/i, "Sony"],

  [/^(?:eos|powershot|ixus)\b|^(?:rf|ef)(?:-s|-m)?[\s\d]/i, "Canon"],
  [/^nikkor\b|^af-[sp]\b|^z\s?\d|^d[1-9]\d{2,3}$|^df$/i, "Nikon"],
  [/^(?:xf|xc|gf)[\s\d]|^x-[a-z]|^x\d{3}|^gfx/i, "Fujifilm"],
  [/^om-/i, "OM System"],
  [/^(?:e-m|pen-|tg-)/i, "Olympus"],
  [/^k-?\d/i, "Pentax"],
  [/^hero\d?/i, "GoPro"],
  [/^fc\d{3,4}$/i, "DJI"],
];

/** The maker a model names without naming it, or `""` when it does not. */
export function inferMaker(model: string): string {
  const found = MAKER_SCHEMES.find(([scheme]) => scheme.test(model));
  return found ? found[1] : "";
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
    raw: { make, model },
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

/**
 * Pulls a teleconverter off the end of a lens name.
 *
 * A 200-600 with a 1.4× on the back is the same lens, used differently — it
 * belongs in the same row of "which lens do I reach for", not in a row of its
 * own two places further down. So the converter is split off here and carried
 * beside the lens rather than inside its name.
 *
 * Only an explicit one counts: a `+` or the word itself. Plenty of lenses have
 * a bare number followed by an x in their name, and none of them mean this.
 */
export function splitTeleconverter(model: string): { optics: string; teleconverter: string | null } {
  const match = model.match(
    /\s*(?:\+\s*)?(\d(?:\.\d)?)\s*x\s*(?:teleconverter|tele\s*converter|extender|tc)?\s*(?:i{1,3})?\s*$/i,
  );
  if (!match) return { optics: model, teleconverter: null };

  // A bare "2x" with nothing marking it as a converter is part of the name.
  const explicit = /\+/.test(match[0]) || /teleconverter|extender|\btc\b/i.test(match[0]);
  if (!explicit) return { optics: model, teleconverter: null };

  const factor = Number(match[1]);
  if (!Number.isFinite(factor) || factor < 1.1 || factor > 3) {
    return { optics: model, teleconverter: null };
  }

  const optics = model.slice(0, model.length - match[0].length).replace(/\s*\+\s*$/, "").trim();
  if (optics === "") return { optics: model, teleconverter: null };

  // `1.4x` and `2x`, however the camera spelled them.
  return { optics, teleconverter: `${factor % 1 === 0 ? factor.toFixed(0) : factor}x` };
}

export interface LensName extends GearName {
  /** `1.4x`, `2x`, or null for the bare lens. */
  teleconverter: string | null;
}

export function normalizeLens(makeRaw: unknown, modelRaw: unknown, spec?: unknown): LensName | null {
  const make = cleanField(makeRaw);
  let model = cleanField(modelRaw);

  if (isPlaceholder(model)) {
    const fromSpec = lensNameFromSpec(spec);
    if (fromSpec === null) return null;
    model = fromSpec;
  }

  // Sigma and Tamron append a release code after a pipe (`| Art 019`).
  const { optics, teleconverter } = splitTeleconverter(model.replace(/\s*\|\s*/g, " "));
  const label = tidyLens(optics);
  const displayMake = make === "" ? "" : tidyMake(make);

  // The make is only worth adding when the name does not already carry a brand.
  // Nikon's lenses say `NIKKOR`, which is Nikon — prepending gives the useless
  // `Nikon NIKKOR Z 24-70mm f/2.8 S`.
  const named = label.toLowerCase().includes(displayMake.toLowerCase()) || label !== stripBrandPrefix(label);
  const withMake = displayMake !== "" && !named ? `${displayMake} ${label}` : label;

  // The key is built from the optics alone — brand stripped, converter removed,
  // aperture notation normalized (`F2.8`, `f/2.8`, `f2.8`), and the release
  // codes Sigma and Tamron append (`019`, `A036`) dropped, since those move
  // with a firmware revision rather than with the glass.
  const key = keyOf(
    stripBrandPrefix(label)
      .replace(/f\s*\/\s*(\d)/gi, "f$1")
      // Only a free-standing token: `100-500mm` and `400 mm` must survive.
      .replace(/(^|\s)[a-z]?\d{3}(?=\s|$)(?!\s*mm)/gi, " "),
  );
  if (key === "") return null;

  // The raw model has the converter taken off it: the lens is the lens.
  return { key, label: withMake, make: displayMake, model: label, raw: { make, model: optics }, teleconverter };
}

// ------------------------------------------------------------- naming ------

/**
 * How gear is written on a slide.
 *
 * These are the reader's preferences, not facts about the data, so they are
 * applied when a deck is built rather than when a file is indexed — changing
 * one re-labels a library of two hundred thousand photographs instantly, and
 * the keys everything is grouped by never move.
 *
 * One switch per part of the name, because they are separate decisions: the
 * mount and the grade carry different information, and wanting `FE 24-70mm GM`
 * with the mount but without the aperture is an ordinary preference that a
 * single short-or-long button could not express.
 */
export interface NamingOptions {
  /** Whether `Sony` belongs in front of `FE 24-70mm GM II`. */
  showMake: boolean;
  /** The mount or format the lens is for: `FE`, `E`, `RF`, `Z`, `XF`. */
  showMount: boolean;
  /** The series it belongs to: `G`, `GM`, `L`, `S`, `Art`, `Sports`. */
  showGrade: boolean;
  /** `F2.8`, `f/5.6-6.3`. */
  showAperture: boolean;
  /** Stabilisation, motors, coatings, formats: `OSS`, `USM`, `ED`, `DG DN`. */
  showJargon: boolean;
  /** Which generation of the lens it is: `II`, `III`. */
  showVersion: boolean;
}

/**
 * What a photographer says out loud.
 *
 * The maker stays because "X-T5" alone is a part number until you know whose it
 * is; the mount, the grade and the generation stay because those are what tell
 * two lenses apart in conversation. The aperture and the engineering go, because
 * nobody says "the 200-600 G OSS" — they say "the 200-600".
 *
 * This is also exactly what the old `lensStyle: "short"` produced, and it has to
 * stay that way: a default that moved would re-label everybody's deck the first
 * time they opened it.
 */
export const DEFAULT_NAMING: NamingOptions = {
  showMake: true,
  showMount: true,
  showGrade: true,
  showAperture: false,
  showJargon: false,
  showVersion: true,
};

/** Every part left in: what the camera wrote, tidied and nothing more. */
export const VERBATIM_NAMING: NamingOptions = {
  showMake: true,
  showMount: true,
  showGrade: true,
  showAperture: true,
  showJargon: true,
  showVersion: true,
};

/**
 * The parts of a lens name that describe the engineering rather than the lens:
 * stabilisation, motor type, coatings, element counts.
 *
 * Deliberately not in here: the series marks — `G`, `GM`, `L`, `S`, `Art`,
 * `Sports` — and version numerals, which have toggles of their own because they
 * are what people *do* say.
 */
const LENS_JARGON =
  /\b(oss|ois|os|vr|vc|is|usm|ssm|sam|stm|lm|wr|xd|rxd|vxd|pz|if|apo|asph|aspherical|ed|hsm|nano|hri|ldh|uld)\b/gi;

/**
 * Format designations that only mean anything as a pair — `DG` is full frame,
 * `DN` is mirrorless, `Di III` is both at once. Dropping half of one and leaving
 * a stranded numeral that was never a version is worse than leaving both alone,
 * so they are matched and removed together.
 */
const LENS_LINES = /\b(dg\s+(?:dn|hsm|os)|dc\s+(?:dn|hsm)|di\s+ii+|di\s+iii)\b/gi;

/** Sigma and Tamron stamp a release code on the barrel: `019`, `A036`. */
const LENS_CODES = /(^|\s)[a-z]?\d{3}(?=\s|$)(?!\s*mm)/gi;

/**
 * What a mount or format prefix looks like, whoever makes it.
 *
 * Per-maker vocabulary, so it lives here beside `BRANDS` rather than in the UI:
 * the settings panel offers the toggle, never the list.
 */
const MOUNTS = new Set([
  "fe", "e", "rf", "rf-s", "ef", "ef-s", "ef-m", "z", "dx", "fx", "dt", "da", "fa", "xf", "xc",
]);

/** The series marks. `G` is Sony's, `S` is Nikon's, `Art` is Sigma's. */
const GRADES = new Set(["g", "gm", "gn", "l", "s", "art", "sports", "contemporary", "pro", "sp"]);

/**
 * The focal length, which is the fixed point every other rule is placed
 * against. Unanchored at the end on purpose: Fujifilm writes the aperture
 * straight onto it, `XF16-55mmF2.8`, and that is still the millimetres.
 */
const FOCAL = /^\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?mm/i;
const token = (word: string) => word.toLowerCase().replace(/[.,]+$/, "");

/**
 * The aperture, and only the aperture.
 *
 * The prefix in the match is what keeps `XF16-55mm` intact: an aperture follows
 * a space or the focal length, never a letter, and the `F16` inside a mount name
 * would otherwise read as f/16 and be deleted. A designation stuck to the end of
 * one survives it, so `f/2.8L` leaves the `L` behind.
 */
function dropAperture(name: string): string {
  return name.replace(/(^|\s|mm)f\s*\/?\s*\d[\d.]*(?:\s*-\s*\d[\d.]*)?([A-Za-z])?/gi, "$1$2");
}

function dropJargon(name: string): string {
  return name.replace(LENS_LINES, " ").replace(LENS_JARGON, " ").replace(LENS_CODES, " ");
}

/**
 * The mount, which is whatever sits in front of the focal length.
 *
 * Position matters as much as the word: Nikon writes `NIKKOR Z 24-70mm f/2.8 S`,
 * where the `Z` is the mount and the `S` at the other end is the grade. Only
 * what comes before the millimetres is a candidate.
 */
function dropMount(name: string): string {
  const words = name.split(" ");
  const focal = words.findIndex((word) => FOCAL.test(word));
  if (focal < 0) return name;

  return words.filter((word, i) => i >= focal || !MOUNTS.has(token(word))).join(" ");
}

/** The grade, which is whatever sits after it — for the same reason. */
function dropGrade(name: string): string {
  const words = name.split(" ");
  const focal = words.findIndex((word) => FOCAL.test(word));

  return words.filter((word, i) => i < focal || !GRADES.has(token(word))).join(" ");
}

/**
 * How the makers write a generation: a roman numeral, or Tamron's `G2`.
 *
 * Single letters are deliberately absent. A lone `V` or `X` is a numeral in
 * theory and a designation in practice, and guessing wrong renames a lens.
 */
const VERSION = /^(?:II|III|IV|VI|VII|VIII|IX|G\d)$/i;

/** Format designations whose numeral is part of the name, not a second edition. */
const NOT_VERSIONS = new Set(["di", "dg", "dc"]);

/**
 * The generation, wherever the maker put it.
 *
 * Not always at the end: Canon writes `EF 24-70mm f/2.8L II USM`, with the motor
 * after the mark. `Di III` is a format designation rather than a third edition,
 * so a numeral only counts as a version when the word before it is not one of
 * those — and `Mark III` leaves with its numeral, since `Mark` alone says even
 * less than `III` alone.
 */
function dropVersion(name: string): string {
  const words = name.split(" ");
  const focal = words.findIndex((word) => FOCAL.test(word));
  const kept: string[] = [];

  words.forEach((word, i) => {
    const previous = token(words[i - 1] ?? "");
    const version = focal >= 0 && i > focal && VERSION.test(token(word)) && !NOT_VERSIONS.has(previous);

    if (!version) {
      kept.push(word);
      return;
    }
    if (previous === "mark") kept.pop();
  });

  return kept.join(" ");
}

/**
 * One rule per toggle, applied in order.
 *
 * The order is not arbitrary. The aperture goes first because a grade can be
 * glued to it (`f/2.8L`), and removing it is what leaves the grade standing on
 * its own to be found; the mount and the grade are then decided by position,
 * which is only stable once the engineering words are out of the way.
 */
export function applyNaming(name: string, options: NamingOptions): string {
  let out = name;
  if (!options.showAperture) out = dropAperture(out);
  if (!options.showJargon) out = dropJargon(out);
  if (!options.showMount) out = dropMount(out);
  if (!options.showGrade) out = dropGrade(out);
  if (!options.showVersion) out = dropVersion(out);

  out = out.replace(/\s{2,}/g, " ").trim();

  // Never shorten a name into nothing: a lens called only by its aperture, or
  // by nothing but jargon, keeps what it had.
  return out === "" || !/\d/.test(out) ? name : out;
}

/** `FE 200-600mm F5.6-6.3 G OSS` becomes `FE 200-600mm G`, the default rules. */
export function shortLensName(name: string): string {
  return applyNaming(name, DEFAULT_NAMING);
}

/**
 * The lens as it should appear, given the reader's preferences.
 *
 * Takes what the camera wrote and runs the whole pipeline — the same one the
 * indexer runs — so a name stored a year ago is written the way the rules say
 * today. Grouping is untouched: this only ever produces a string.
 */
/**
 * The name with a maker in front of it, including one the file never gave.
 *
 * At read time rather than at index time, like every other naming rule: the
 * index keeps what the camera wrote, and a scheme learned about today reaches a
 * library indexed months ago without re-reading a file. A model that already
 * names its own maker is left exactly as it is — `Nikon NIKKOR Z 24-70mm` and
 * `Apple iPhone 13` are what happens to anyone who forgets to check.
 */
function withMaker(model: string, make: string, label: string): string {
  if (make !== "") return label;

  const maker = inferMaker(model);
  if (maker === "") return label;

  const named =
    model.toLowerCase().includes(maker.toLowerCase()) ||
    brandOf(model.split(" ")[0] ?? "") !== undefined ||
    familyOf(model.split(" ")[0] ?? "") !== undefined ||
    model !== stripBrandPrefix(model);

  return named ? label : `${maker} ${model}`;
}

export function describeLens(
  makeRaw: string,
  modelRaw: string,
  options: NamingOptions = DEFAULT_NAMING,
): string {
  const name = normalizeLens(makeRaw, modelRaw);
  if (!name) return modelRaw;

  const written = options.showMake ? withMaker(name.model, name.make, name.label) : name.model;
  return applyNaming(written, options);
}

/** The body as it should appear. */
export function describeCamera(
  makeRaw: string,
  modelRaw: string,
  options: NamingOptions = DEFAULT_NAMING,
): string {
  const name = normalizeCamera(makeRaw, modelRaw);
  if (!name) return modelRaw;
  return options.showMake ? withMaker(name.model, name.make, name.label) : name.model;
}

/** The pairing the deck is really about: one body, one lens. */
export function comboLabel(camera: string, lens: string): string {
  return `${camera} + ${lens}`;
}
