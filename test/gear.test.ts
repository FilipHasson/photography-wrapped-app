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

  test("says what a Sony body is actually called", () => {
    assert.equal(normalizeCamera("SONY", "ILCE-7RM5")?.label, "Sony a7R V");
    // The alias is cosmetic; an unmapped body keeps its own name.
    assert.equal(normalizeCamera("SONY", "ILCE-0000")?.label, "Sony ILCE-0000");
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
