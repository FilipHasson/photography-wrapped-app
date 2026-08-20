import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  applyNaming,
  DEFAULT_NAMING,
  VERBATIM_NAMING,
  describeCamera,
  describeLens,
  normalizeCamera,
  normalizeLens,
  lensNameFromSpec,
  shortLensName,
  splitTeleconverter,
  type NamingOptions,
} from "../src/core/gear.ts";
import { coerceNaming } from "../src/core/config.ts";

/**
 * The invariant these tests exist for: the same piece of kit must produce the
 * same key however it was described. Break that and a lens quietly splits into
 * two rows on the slide it is supposed to top.
 */

const cameraKey = (make: unknown, model: unknown) => normalizeCamera(make, model)?.key;
const lensKey = (make: unknown, model: unknown, spec?: unknown) => normalizeLens(make, model, spec)?.key;

describe("cameras", () => {
  test("a body is one body however the make is spelled", () => {
    // EXIF, a video's QuickTime atoms, and a Lightroom catalog, in that order.
    assert.equal(cameraKey("NIKON CORPORATION", "NIKON Z 8"), cameraKey("NIKON", "NIKON Z 8"));
    assert.equal(cameraKey("NIKON CORPORATION", "NIKON Z 8"), cameraKey(null, "NIKON Z 8"));
  });

  test("tidies the name without touching the key", () => {
    const nikon = normalizeCamera("NIKON CORPORATION", "NIKON Z 8");
    assert.equal(nikon?.label, "Nikon Z 8");

    const canon = normalizeCamera("Canon", "Canon EOS R5");
    assert.equal(canon?.label, "Canon EOS R5");
  });

  /**
   * One row per way a maker writes its own name. The point of the table is that
   * a shelf of mixed gear reads as one list rather than as five naming schemes,
   * so these are checked together rather than a brand at a time.
   */
  test("every major maker comes out named the way people say it", () => {
    const cases: Array<[string, string, string]> = [
      // Cameras.
      ["NIKON CORPORATION", "NIKON Z 8", "Nikon Z 8"],
      ["NIKON CORPORATION", "NIKON D850", "Nikon D850"],
      ["Canon", "Canon EOS R5", "Canon EOS R5"],
      ["Canon", "Canon EOS 5D Mark IV", "Canon EOS 5D Mark IV"],
      ["SONY", "ILCE-7M4", "Sony a7 IV"],
      ["FUJIFILM", "X-T5", "Fujifilm X-T5"],
      ["FUJIFILM", "GFX100S", "Fujifilm GFX100S"],
      ["Panasonic", "DC-S5M2", "Lumix S5 II"],
      ["Panasonic", "DMC-GH4", "Lumix GH4"],
      ["OLYMPUS CORPORATION", "E-M1MarkIII", "Olympus E-M1 Mark III"],
      ["OM Digital Solutions", "OM-1", "OM System OM-1"],
      ["RICOH IMAGING COMPANY, LTD.", "PENTAX K-3 Mark III", "Pentax K-3 Mark III"],
      ["RICOH IMAGING COMPANY, LTD.", "RICOH GR III", "Ricoh GR III"],
      ["Leica Camera AG", "M11", "Leica M11"],
      ["Leica Camera AG", "LEICA Q3", "Leica Q3"],
      ["Hasselblad", "X2D 100C", "Hasselblad X2D 100C"],
      ["SIGMA", "SIGMA fp L", "Sigma fp L"],
      ["Phase One A/S", "IQ4 150MP", "Phase One IQ4 150MP"],
      ["Eastman Kodak Company", "KODAK EKTRA", "Kodak EKTRA"],
      ["GoPro", "HERO11 Black", "GoPro HERO11 Black"],
      ["DJI", "Mavic 3", "DJI Mavic 3"],
      // Phones. A model that names its own maker does not get it twice.
      ["Apple", "iPhone 15 Pro", "iPhone 15 Pro"],
      ["Apple", "iPad Pro (11-inch)", "iPad Pro (11-inch)"],
      ["Google", "Pixel 8 Pro", "Pixel 8 Pro"],
      ["samsung", "SM-S928B", "Galaxy S24 Ultra"],
      ["samsung", "SM-G998B", "Galaxy S21 Ultra"],
      ["samsung", "SM-F946U", "Galaxy Z Fold5"],
      ["samsung", "SM-A546E", "Galaxy A54"],
      ["motorola", "moto g stylus 5G", "Moto G Stylus 5G"],
      ["Xiaomi", "Redmi Note 12", "Redmi Note 12"],
      ["HUAWEI", "ELS-NX9", "Huawei ELS-NX9"],
      ["OnePlus", "CPH2449", "OnePlus CPH2449"],
    ];

    for (const [make, model, expected] of cases) {
      assert.equal(normalizeCamera(make, model)?.label, expected, `${make} / ${model}`);
    }
  });

  test("a code nobody can decode keeps the code", () => {
    // Guessing would be worse than saying what the file says: DJI's drone codes
    // and Samsung's flagship service codes have no rule behind them.
    assert.equal(normalizeCamera("DJI", "FC3582")?.label, "DJI FC3582");
    assert.equal(normalizeCamera("samsung", "SM-X999Z")?.label, "Samsung SM-X999Z");
  });

  test("naming a body never merges it with another", () => {
    // Every rule above is display-only; the key stays the model as written.
    const pairs: Array<[string, string]> = [
      ["ILCE-7M2", "ILCE-7M3"],
      ["DC-S5M2", "DC-S5"],
      ["SM-S928B", "SM-S921B"],
      ["E-M1MarkIII", "E-M1MarkII"],
    ];
    for (const [a, b] of pairs) {
      assert.notEqual(normalizeCamera("", a)?.key, normalizeCamera("", b)?.key, `${a} vs ${b}`);
    }
  });

  test("says what a Sony body is actually called, consistently", () => {
    // A rule rather than a lookup table, so every body in the line comes out in
    // the same shape — including the ones nobody thought to add.
    const label = (model: string) => normalizeCamera("SONY", model)?.label;
    assert.equal(label("ILCE-7M2"), "Sony a7 II");
    assert.equal(label("ILCE-7RM5"), "Sony a7R V");
    assert.equal(label("ILCE-7SM3"), "Sony a7S III");
    assert.equal(label("ILCE-9M3"), "Sony a9 III");
    assert.equal(label("ILCE-1"), "Sony a1");
    assert.equal(label("ILCE-6700"), "Sony a6700");
    assert.equal(label("ILME-FX3"), "Sony FX3");
    assert.equal(label("DSC-RX100M7"), "Sony RX100 VII");
    assert.equal(label("ZV-E10"), "Sony ZV-E10");
  });

  test("the Sony renaming never merges two bodies", () => {
    // It is a display rule; the key is still the model the camera wrote.
    assert.notEqual(normalizeCamera("SONY", "ILCE-7M2")?.key, normalizeCamera("SONY", "ILCE-7M3")?.key);
    assert.equal(normalizeCamera("SONY", "ILCE-7M2")?.key, normalizeCamera(null, "ILCE-7M2")?.key);
  });

  test("gives up rather than inventing a camera", () => {
    assert.equal(normalizeCamera("", ""), null);
    assert.equal(normalizeCamera(null, "unknown"), null);
  });
});

describe("lenses", () => {
  test("one lens, whether or not the make came separately", () => {
    assert.equal(
      lensKey("SIGMA", "24-70mm F2.8 DG DN | Art 019"),
      lensKey("", "Sigma 24-70mm F2.8 DG DN Art"),
    );
    assert.equal(
      lensKey("NIKON", "NIKKOR Z 24-70mm f/2.8 S"),
      lensKey(null, "NIKKOR Z 24-70mm f/2.8 S"),
    );
    assert.equal(
      lensKey("Canon", "RF100-500mm F4.5-7.1 L IS USM"),
      lensKey(null, "RF100-500mm F4.5-7.1 L IS USM"),
    );
  });

  test("two lenses stay two lenses", () => {
    assert.notEqual(
      lensKey("SIGMA", "24-70mm F2.8 DG DN | Art 019"),
      lensKey("TAMRON", "28-75mm F/2.8 Di III VXD A036"),
    );
    assert.notEqual(
      lensKey("", "EF24-70mm f/2.8L II USM"),
      lensKey("", "EF24-70mm f/2.8L USM"),
    );
  });

  test("a focal length is not a release code", () => {
    // `019` is Sigma's; `100` in `100-500mm` is the lens.
    assert.ok(lensKey("Canon", "RF100-500mm F4.5-7.1 L IS USM")?.includes("100500"));
  });

  test("falls back to the specification when there is no name", () => {
    assert.equal(lensNameFromSpec([24, 70, 2.8, 2.8]), "24-70mm f/2.8");
    assert.equal(lensNameFromSpec([50, 50, 1.8, 1.8]), "50mm f/1.8");
    assert.equal(lensNameFromSpec([100, 400, 4.5, 6.3]), "100-400mm f/4.5-6.3");
    assert.equal(lensNameFromSpec([]), null);

    // Manual lenses report a placeholder name; the specification still works.
    assert.equal(normalizeLens("", "0mm f/0", [24, 70, 2.8, 2.8])?.label, "24-70mm f/2.8");
  });

  test("does not name a lens it knows nothing about", () => {
    assert.equal(normalizeLens("", "----"), null);
    assert.equal(normalizeLens(null, null), null);
  });

  test("leaves a name alone when the brand is already in it", () => {
    assert.equal(normalizeLens("NIKON", "NIKKOR Z 24-70mm f/2.8 S")?.label, "NIKKOR Z 24-70mm f/2.8 S");
    assert.equal(normalizeLens("SIGMA", "24-70mm F2.8 DG DN")?.label, "Sigma 24-70mm F2.8 DG DN");
  });
});

describe("teleconverters", () => {
  test("a lens with a converter is the same lens", () => {
    const bare = normalizeLens("SONY", "FE 200-600mm F5.6-6.3 G OSS");
    const with14 = normalizeLens("SONY", "FE 200-600mm F5.6-6.3 G OSS + 1.4X Teleconverter");
    const with20 = normalizeLens("SONY", "FE 200-600mm F5.6-6.3 G OSS + 2X Teleconverter");

    // One key, so one row on the slide and one bar to split into shades.
    assert.equal(with14?.key, bare?.key);
    assert.equal(with20?.key, bare?.key);
    assert.equal(bare?.teleconverter, null);
    assert.equal(with14?.teleconverter, "1.4x");
    assert.equal(with20?.teleconverter, "2x");
  });

  test("reads the ways other makers write it", () => {
    assert.equal(splitTeleconverter("RF100-500mm F4.5-7.1 L IS USM +1.4x III").teleconverter, "1.4x");
    assert.equal(splitTeleconverter("EF 300mm f/2.8L + 2x Extender").teleconverter, "2x");
    assert.equal(splitTeleconverter("EF 300mm f/2.8L IS II USM").teleconverter, null);
  });

  test("a number in a name is not a converter", () => {
    // Nothing here is a converter, and guessing one would merge two lenses.
    for (const name of ["Laowa 2x Ultra Macro", "24-70mm F2.8", "Vario-Sonnar T* 24-70mm"]) {
      assert.equal(splitTeleconverter(name).teleconverter, null, name);
    }
  });
});

describe("how a name is written", () => {
  test("short names say what a photographer says", () => {
    const short = (make: string, model: string) =>
      describeLens(make, model, { ...DEFAULT_NAMING, showMake: false });

    assert.equal(short("SONY", "FE 200-600mm F5.6-6.3 G OSS"), "FE 200-600mm G");
    assert.equal(short("SONY", "FE 70-200mm F2.8 GM OSS II"), "FE 70-200mm GM II");
    assert.equal(short("SONY", "FE 24-70mm F2.8 GM II"), "FE 24-70mm GM II");
    assert.equal(short("SONY", "FE 600mm F4 GM OSS"), "FE 600mm GM");
    assert.equal(short("NIKON", "NIKKOR Z 24-70mm f/2.8 S"), "NIKKOR Z 24-70mm S");
    assert.equal(short("Canon", "RF100-500mm F4.5-7.1 L IS USM"), "RF 100-500mm L");
  });

  test("the full name is still the full name", () => {
    assert.equal(
      describeLens("SONY", "FE 200-600mm F5.6-6.3 G OSS", { ...VERBATIM_NAMING, showMake: false }),
      "FE 200-600mm F5.6-6.3 G OSS",
    );
  });

  test("the maker can be left off, or kept", () => {
    const model = "FE 24-70mm F2.8 GM II";
    assert.equal(describeLens("SONY", model, { ...DEFAULT_NAMING, showMake: true }), "Sony FE 24-70mm GM II");
    assert.equal(describeLens("SONY", model, { ...DEFAULT_NAMING, showMake: false }), "FE 24-70mm GM II");

    assert.equal(describeCamera("SONY", "ILCE-9M3", { ...DEFAULT_NAMING, showMake: true }), "Sony a9 III");
    assert.equal(describeCamera("SONY", "ILCE-9M3", { ...DEFAULT_NAMING, showMake: false }), "a9 III");
  });

  test("shortening never leaves nothing behind", () => {
    // A name that is nothing but jargon keeps what it had.
    assert.equal(shortLensName("OSS"), "OSS");
    assert.equal(shortLensName("f/2.8"), "f/2.8");
  });

  test("a stale label is rewritten, not re-indexed", () => {
    // The point of describing from the raw name: a body indexed before the
    // Sony rule existed reads correctly the next time a deck is built.
    assert.equal(describeCamera("SONY", "ILCE-7M2", { ...DEFAULT_NAMING, showMake: true }), "Sony a7 II");
  });
});

/**
 * One toggle, one change. The rules are separate because the decisions are:
 * wanting the mount without the aperture is an ordinary preference, and the old
 * short-or-long switch could not express it.
 */
describe("one toggle at a time", () => {
  const naming = (options: Partial<NamingOptions>): NamingOptions => ({
    ...VERBATIM_NAMING,
    showMake: false,
    ...options,
  });
  const written = (make: string, model: string, options: Partial<NamingOptions> = {}) =>
    describeLens(make, model, naming(options));

  test("the mount comes off, and only the mount", () => {
    assert.equal(written("SONY", "FE 24-70mm F2.8 GM II", { showMount: false }), "24-70mm F2.8 GM II");
    assert.equal(written("SONY", "E 18-135mm F3.5-5.6 OSS", { showMount: false }), "18-135mm F3.5-5.6 OSS");
    // Nikon puts the mount in the middle and the grade at the end, so position
    // decides which is which: the `Z` goes and the `S` stays.
    assert.equal(written("NIKON", "NIKKOR Z 24-70mm f/2.8 S", { showMount: false }), "NIKKOR 24-70mm f/2.8 S");
  });

  test("the grade comes off, and only the grade", () => {
    assert.equal(written("SONY", "FE 24-70mm F2.8 GM II", { showGrade: false }), "FE 24-70mm F2.8 II");
    assert.equal(written("NIKON", "NIKKOR Z 24-70mm f/2.8 S", { showGrade: false }), "NIKKOR Z 24-70mm f/2.8");
    assert.equal(written("SIGMA", "24-70mm F2.8 DG DN | Art 019", { showGrade: false }), "24-70mm F2.8 DG DN 019");
  });

  test("the aperture comes off, and the designation stuck to it stays", () => {
    assert.equal(written("SONY", "FE 200-600mm F5.6-6.3 G OSS", { showAperture: false }), "FE 200-600mm G OSS");
    // `f/2.8L` is one word to a camera and two facts to a photographer.
    assert.equal(written("Canon", "EF24-70mm f/2.8L II USM", { showAperture: false }), "EF 24-70mm L II USM");
    // Fujifilm writes it straight onto the millimetres.
    assert.equal(written("FUJIFILM", "XF16-55mmF2.8 R LM WR", { showAperture: false }), "XF 16-55mm R LM WR");
  });

  test("the jargon comes off, paired designations included", () => {
    assert.equal(written("SONY", "FE 70-200mm F2.8 GM OSS II", { showJargon: false }), "FE 70-200mm F2.8 GM II");
    // Half of `DG DN` is worse than all of it, so the pair leaves together.
    assert.equal(written("SIGMA", "24-70mm F2.8 DG DN | Art 019", { showJargon: false }), "24-70mm F2.8 Art");
    assert.equal(written("TAMRON", "28-75mm F/2.8 Di III VXD G2", { showJargon: false }), "28-75mm F/2.8 G2");
  });

  test("the version comes off, wherever the maker put it", () => {
    assert.equal(written("SONY", "FE 70-200mm F2.8 GM OSS II", { showVersion: false }), "FE 70-200mm F2.8 GM OSS");
    // Canon writes the motor after the mark.
    assert.equal(written("Canon", "EF24-70mm f/2.8L II USM", { showVersion: false }), "EF 24-70mm f/2.8L USM");
    // Tamron counts its generations with a G.
    assert.equal(written("TAMRON", "28-75mm F/2.8 Di III VXD G2", { showVersion: false }), "28-75mm F/2.8 Di III VXD");
    // `Di III` is a format, not a third edition: the numeral belongs to it.
    assert.match(written("TAMRON", "28-75mm F/2.8 Di III VXD", { showVersion: false }), /Di III/);
  });

  test("the maker comes off without touching the rest", () => {
    assert.equal(describeLens("SONY", "FE 24-70mm F2.8 GM II", naming({ showMake: true })), "Sony FE 24-70mm F2.8 GM II");
    assert.equal(describeLens("SONY", "FE 24-70mm F2.8 GM II", naming({})), "FE 24-70mm F2.8 GM II");
  });

  test("two at once do both things and nothing else", () => {
    assert.equal(
      written("SONY", "FE 200-600mm F5.6-6.3 G OSS", { showAperture: false, showJargon: false }),
      "FE 200-600mm G",
    );
    assert.equal(
      written("Canon", "RF100-500mm F4.5-7.1 L IS USM", { showMount: false, showGrade: false }),
      "100-500mm F4.5-7.1 IS USM",
    );
    assert.equal(
      written("SONY", "FE 70-200mm F2.8 GM OSS II", {
        showMount: false,
        showGrade: false,
        showAperture: false,
        showJargon: false,
        showVersion: false,
      }),
      "70-200mm",
    );
  });

  test("everything on is what the camera wrote", () => {
    for (const [make, model] of [
      ["SONY", "FE 200-600mm F5.6-6.3 G OSS"],
      ["NIKON", "NIKKOR Z 24-70mm f/2.8 S"],
      ["FUJIFILM", "XF16-55mmF2.8 R LM WR"],
    ] as Array<[string, string]>) {
      const verbatim = written(make, model);
      assert.match(verbatim, /\d/);
      // Nothing has been taken out: every word of the tidied name survives.
      for (const word of model.replace(/\s*\|\s*/g, " ").split(" ")) {
        if (word === "" || /^\d{3}$/.test(word)) continue;
        assert.ok(verbatim.includes(word.replace(/^XF/, "")), `${model} lost "${word}"`);
      }
    }
  });

  test("a name is never shortened into nothing", () => {
    assert.equal(shortLensName("OSS"), "OSS");
    assert.equal(shortLensName("f/2.8"), "f/2.8");
    assert.equal(applyNaming("FE", { ...VERBATIM_NAMING, showMount: false }), "FE");
  });

  test("no toggle moves a key", () => {
    // The invariant the whole deck rests on. Display rules rewrite the label;
    // the key is built by `normalizeLens` and never sees these options at all.
    const model = "FE 70-200mm F2.8 GM OSS II";
    const key = normalizeLens("SONY", model)?.key;

    for (const option of Object.keys(VERBATIM_NAMING) as Array<keyof NamingOptions>) {
      describeLens("SONY", model, naming({ [option]: false }));
      assert.equal(normalizeLens("SONY", model)?.key, key, `${option} moved the key`);
    }
  });
});

/**
 * Nobody's deck changes under them. The old switch had two settings and both
 * have to keep producing exactly the names they produced.
 */
describe("a config written before the toggles", () => {
  const lenses = [
    "FE 200-600mm F5.6-6.3 G OSS",
    "FE 70-200mm F2.8 GM OSS II",
    "NIKKOR Z 24-70mm f/2.8 S",
    "RF100-500mm F4.5-7.1 L IS USM",
    "24-70mm F2.8 DG DN | Art 019",
  ];

  test("reads short as the six flags it stood for", () => {
    const naming = coerceNaming({ lensStyle: "short", showMake: true });
    assert.deepEqual(naming, DEFAULT_NAMING);

    assert.deepEqual(
      lenses.map((model) => describeLens("SONY", model, { ...naming, showMake: false })),
      ["FE 200-600mm G", "FE 70-200mm GM II", "NIKKOR Z 24-70mm S", "RF 100-500mm L", "24-70mm Art"],
    );
  });

  test("reads as written as every part kept", () => {
    const naming = coerceNaming({ lensStyle: "full", showMake: false });
    assert.equal(naming.showAperture, true);
    assert.equal(naming.showJargon, true);
    assert.equal(naming.showMake, false);

    assert.equal(
      describeLens("SONY", "FE 200-600mm F5.6-6.3 G OSS", naming),
      "FE 200-600mm F5.6-6.3 G OSS",
    );
  });

  test("a config with the flags in it is left alone", () => {
    const naming = coerceNaming({ showMount: false, showGrade: false, lensStyle: "full" });
    assert.equal(naming.showMount, false);
    assert.equal(naming.showGrade, false);
    // The flags win: `lensStyle` is what a file says when it has never seen them.
    assert.equal(naming.showAperture, DEFAULT_NAMING.showAperture);
  });

  test("a config with no naming at all gets the defaults", () => {
    assert.deepEqual(coerceNaming(undefined), DEFAULT_NAMING);
    assert.deepEqual(coerceNaming({}), DEFAULT_NAMING);
  });
});
