import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeCamera, normalizeLens, lensNameFromSpec } from "../src/core/gear.ts";

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
