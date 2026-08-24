import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { coercePalette, PALETTE_ROLES } from "../src/core/config.ts";

/**
 * The reader's own colours.
 *
 * Two things are being defended here and they pull in opposite directions. A
 * palette has to be *changeable*, or the setting is a lie; and it has to stay
 * *readable*, or a chart quietly stops telling the truth to about one man in
 * twelve. The gates are the second half, and the first thing they have to do is
 * pass the palette that ships — a warning nobody can act on trains people to
 * ignore warnings that matter.
 */

type Theme = { mode: string; series: string[]; ramp: string[]; surface: string; blank: string };
type Problem = { role: string; severity: string; text: string };

let themeFor: (mode: string, override: Record<string, string>) => Theme;
let paletteProblems: (theme: Theme) => Problem[];
let seriesColour: (index: number, theme: Theme) => string;
let colourAt: (theme: Theme, role: string) => string | null;

before(async () => {
  // @ts-expect-error — untyped module, imported for its behaviour.
  ({ themeFor, paletteProblems, seriesColour, colourAt } = await import("../src/web/theme.js"));
});

describe("a palette the reader has changed", () => {
  test("an empty override is the built-in palette, untouched", () => {
    // The promise the sparse format makes: a config with no colours in it draws
    // exactly what it drew before there was a setting.
    for (const mode of ["light", "dark"]) {
      const base = themeFor(mode, {});
      assert.equal(base, themeFor(mode, {}), `${mode} built a new object for nothing`);
      assert.equal(themeFor(mode, {} as Record<string, string>).series.length, 8);
    }
  });

  test("changes only the roles it names", () => {
    const theme = themeFor("light", { "series.3": "#123456", blank: "#abcdef" });
    const base = themeFor("light", {});

    assert.equal(theme.series[3], "#123456");
    assert.equal(theme.blank, "#abcdef");
    assert.equal(theme.series[0], base.series[0], "an untouched slot moved");
    assert.deepEqual(theme.ramp, base.ramp);
    // And never writes through to the built-in, which every other render uses.
    assert.notEqual(base.series[3], "#123456");
  });

  test("ignores a role that means nothing", () => {
    const theme = themeFor("light", { "series.99": "#123456", nonsense: "#123456", "ramp.x": "#123456" });
    assert.deepEqual(theme.series, themeFor("light", {}).series);
    assert.deepEqual(theme.ramp, themeFor("light", {}).ramp);
  });

  test("every role the picker offers is a role the theme has", () => {
    // The two lists live on either side of the wire, so this is what stops one
    // of them growing an entry the other cannot draw.
    const theme = themeFor("light", {});
    for (const role of PALETTE_ROLES) {
      assert.ok(colourAt(theme, role.id), `${role.id} names nothing in the theme`);
    }
  });
});

describe("what a saved palette is allowed to contain", () => {
  test("keeps the colours, drops the rest", () => {
    const palette = coercePalette({
      light: { "series.0": "#8E44AD", "bogus.9": "#123456", blank: "not a colour", ramp: "#fff" },
      dark: { night: "#00ffcc" },
    });

    assert.deepEqual(palette.light, { "series.0": "#8e44ad" });
    assert.deepEqual(palette.dark, { night: "#00ffcc" });
  });

  test("a config that has never seen one is empty, not broken", () => {
    assert.deepEqual(coercePalette(undefined), { light: {}, dark: {} });
    assert.deepEqual(coercePalette("nonsense"), { light: {}, dark: {} });
  });
});

describe("the gates", () => {
  test("the palette that ships raises no warning", () => {
    // The regression that matters most here. Contrast notes are expected and
    // documented — three light steps sit under 3:1, which is one of the reasons
    // every chart also has a table — but nothing should be a warning.
    for (const mode of ["light", "dark"]) {
      const warnings = paletteProblems(themeFor(mode, {})).filter((one) => one.severity === "warn");
      assert.deepEqual(warnings, [], `the built-in ${mode} palette warns about itself`);
    }
  });

  test("two neighbours a colour-blind reader cannot separate", () => {
    const theme = themeFor("light", { "series.1": "#2f7fd8" });
    const warnings = paletteProblems(theme).filter((one) => one.severity === "warn");

    assert.ok(warnings.some((one) => one.text.includes("colour-blind")), JSON.stringify(warnings));
    // Named, so the reader knows which two of eight swatches to go and change.
    assert.ok(warnings.every((one) => one.role === "series.0"));
  });

  test("a heat ramp that stops climbing, and one that doubles back", () => {
    const flat = paletteProblems(themeFor("light", { "ramp.2": "#9ec5f4" }));
    assert.ok(flat.some((one) => one.text.includes("same brightness")));

    const reversed = paletteProblems(themeFor("light", { "ramp.2": "#cde2fb" }));
    assert.ok(reversed.some((one) => one.text.includes("changes direction")));
  });

  test("a colour nobody could see against the page", () => {
    const notes = paletteProblems(themeFor("light", { "series.0": "#fbfbfa" }));
    assert.ok(notes.some((one) => one.role === "series.0" && one.severity === "note"));
  });
});

describe("the colours past the eighth slot", () => {
  test("follow the reader's palette rather than the built-in one", () => {
    // The generator scores each new colour against the ones already on the
    // chart, so a changed palette has to produce different ninth and tenth
    // colours — and the cache that holds them was keyed on nothing at all,
    // which made this the first thing to break the moment a palette could move.
    const base = themeFor("light", {});
    const mine = themeFor("light", { "series.7": "#0f8a8a", "series.6": "#7d3cb5" });

    const ninth = { base: seriesColour(8, base), mine: seriesColour(8, mine) };
    assert.notEqual(ninth.base, ninth.mine, "the ninth colour ignored the palette it was generated against");

    // And still stable: asking twice gives the same answer, or a rebuild would
    // repaint every lens past the eighth.
    assert.equal(seriesColour(8, mine), ninth.mine);
    assert.equal(seriesColour(8, base), ninth.base);
  });

  test("are still all different from each other", () => {
    const mine = themeFor("dark", { "series.0": "#7d3cb5", "series.3": "#0f8a8a" });
    const colours = Array.from({ length: 25 }, (_, i) => seriesColour(i, mine));
    assert.equal(new Set(colours).size, 25);
  });
});
