# Photography Wrapped — working notes

Counts a photography library and turns the counts into slides. See `README.md`
for user-facing behaviour. This file is the map for changing it.

## Ground rules

1. **Read-only, always.** Photographs are opened for their headers and never
   written to; a Lightroom catalog is copied before it is read. Any path that
   modifies, moves or deletes media is wrong by construction.
2. **Never claim more than was counted.** Share of shots on a lens is share of
   the shots whose lens is *known* — every percentage on a slide divides by the
   frames that carried the field, never by the library. Inventing a denominator
   is the one bug that makes the whole deck untrustworthy. The denominators
   themselves live in the table view rather than in a footnote under every
   slide: "8,412 of 16,000 frames recorded one" was noise on nineteen slides.
3. **No build step.** Node runs the TypeScript directly, so only *erasable*
   syntax: no `enum`, no `namespace`, no parameter properties, and `import type`
   for type-only imports. `npm run typecheck` enforces it via `erasableSyntaxOnly`.
4. **One runtime dependency** (`exifr`). SQLite, the HTTP server and the PDF
   writer are all built in. Keep it that way unless there is a strong reason.
5. **No network.** Nothing here should ever make a request.

## Layout

```
src/core/      config, SQLite wrapper, EXIF and QuickTime reading, gear naming,
               exposure units, timezone-free dates
src/index/     walking sources into the index, and deciding what is a duplicate
src/stats/     ranges, the aggregation queries, and the slide copy
src/server/    HTTP API, job runner, static hosting
src/web/       the UI — plain HTML/CSS/ES modules, no framework;
               formats.js is the posting shapes, chart.js draws into them
tools/         fixture generators: an EXIF/MP4 writer and a Lightroom catalog
```

Dependencies point one way: `web → server → stats → index → core`.

## The parts that carry the weight

**Naming happens at read time.** `camera` and `lens` rows keep `raw_make`/`raw_model`
— the name exactly as the camera wrote it — and `stats/aggregate.ts` builds every
label from those through `describeCamera`/`describeLens` with the reader s naming
options. That is why a naming rule added today fixes a library indexed months
ago, and why the settings panel can re-label two hundred thousand photographs
without re-reading a file. Keys never move: they are still the model as written.

**A maker can be inferred, never invented.** `inferMaker` reads the maker off a
naming scheme for the rows that carry none — a catalog stores a model and
nothing else, which left the maker toggle with no name to put in front. Only
schemes belonging to exactly one maker are in `MAKER_SCHEMES`, the third-party
designations are checked first (`A071` is Tamron's whatever mount it is on), and
the mount is never read as the maker. It runs in `describeCamera`/`describeLens`
at read time, not in `normalizeCamera`/`normalizeLens`: the index keeps what the
camera wrote, and a scheme added today reaches a library indexed months ago.

**Naming is six switches, one rule each.** `NamingOptions` is a set of booleans
and `applyNaming` runs one function per part of a name — aperture, jargon,
mount, grade, version — in that order, which is not arbitrary: the aperture goes
first because a grade can be glued to it (`f/2.8L`), and mount and grade are
decided by *position* relative to the focal length, which is only stable once
the engineering words are gone. Nikon is the case that proves it: `NIKKOR Z
24-70mm f/2.8 S` has the mount before the millimetres and the grade after them.
The defaults reproduce the old `lensStyle: "short"` exactly, and `coerceNaming`
reads that old key back as the flags it stood for, because a default that moved
would re-label everybody's deck the first time they opened it.

**`core/gear.ts`** — two jobs, and they must not be confused. Naming is a table
of makers and product lines (`BRANDS`, `FAMILIES`, `MAKE_ALIASES`) plus a rule
per maker that writes codes rather than names — Sony `ILCE-`, Panasonic `DC-`,
Samsung `SM-`, Olympus `MarkIII`. Rules are preferred to tables wherever the
maker has a scheme, because a table only fixes the bodies someone remembered to
add. Where there is no scheme (DJI drone codes, Samsung flagships) the code is
left alone rather than guessed at, and *all* of it is display-only: the key is
the model exactly as written.

Grouping is the other job. The whole deck rests on "the same lens is one lens". Names
arrive spelled differently depending on where they were read, so every name
splits into a **key** (aggressive normalisation, used for grouping) and a
**label** (tidied for looks). The key drops the brand prefix, because a folder
source reads `LensMake` separately while a catalog hands over one string; it
keeps family markers like `DG DN` and `Di III`, because with the brand gone
those are what keep a Sigma 24-70/2.8 apart from a Tamron one. `normalizeCamera`
keys on the model *exactly as written* — see the comment there before "fixing"
the make-prefix handling, which has already caused a video and its stills to
count as two bodies.

**`index/enrich.ts` → `shotKeyFor`** — frame identity is
`body + wall-clock second + file stem`. Sub-second EXIF is deliberately unused:
catalogs do not store it, and keying on it double-counts every raw + JPEG pair
for anyone who indexes a folder *and* its catalog. `test/lightroom.test.ts`
covers exactly that.

**`index/dedupe.ts`** — two passes, in this order: by path (exact — settles two
sources describing the same file), then by frame (inferred — settles raw+JPEG
and backup copies). They cannot be merged, and the order cannot be swapped. The
pass also fills gaps between rows describing one photograph: a catalog row knows
the rating but not the file size, a folder row the reverse. Those inherited
fields are reset to their source-native values first, so running the pass twice
gives the same answer.

**`stats/aggregate.ts`** — one query per slide, all sharing the predicate
`is_primary = 1 AND present = 1 AND day BETWEEN ? AND ?`, which is exactly what
`idx_photo_day` indexes. Values are bucketed in JS rather than SQL because the
scales are logarithmic and irregular.

**`web/chart.js`** — slides are SVG with every colour written on as an attribute
and no stylesheet. That is not a style choice: export rasterises the serialised
SVG through an `<img>`, which renders in isolation, so anything inherited from
the page would silently disappear from the PNG and the PDF.

Nothing in it is hard-coded to a canvas size. `web/formats.js` holds the five
posting shapes and their type scales, and **9:16 is the default and the shape
the layouts are tuned for**. The narrow formats set type *larger* relative to
their width, not smaller: a 20px label reads fine across 1600px of laptop and is
a third of the apparent size on a phone, which is the whole reason the first
version of these slides was unusable in the place they were made for.

Four rules keep a tall frame from filling with air, and all of them were written
after measuring how little of it the charts actually used:

- charts take the height they are given, with caps only generous enough to stop
  two rows becoming two enormous ones — never a fixed row height
- the calendar tiles months into a grid whose column count is chosen by trying
  them all and keeping the biggest day square, so one month fills a story and a
  year fits either way up
- the map fits its window to the points, padded and squared off to the slide,
  rather than drawing a world with four dots in the middle of it
- a list the reader has made longer buys its rows out of the *type size*
  (`compress` in `chart.js`), never out of the gaps: the row limit is a setting,
  so twenty bars have to fit where eight did

Vertical spacing is always measured off the *larger* of two adjacent type sizes —
that is what the overlap check in `test/render.test.ts` enforces, and what it
caught when it was not.

**The contact sheet** (`renderSheet` in `web/deck.js`) draws the whole deck into
one grid, and its column count is computed against the window so the sheet fits
in a single screenshot — which is the only thing it is for. It renders through
`renderSlide` like everything else, so it is the deck rather than a preview of it.

**`server/freshness.ts`** answers the question that has cost more time here than
any real bug: *is the running server still the code on disk?* Node reads this
project's TypeScript once at startup, so editing a file while the server is up
changes nothing until it is restarted — and the page then shows an old deck with
no clue why. The newest mtime under `src/` is recorded at boot, re-checked on
every `/api/state`, and the page puts a banner up when they differ.

**Deletions are counted at the sweep or never.** Nothing in a catalog records
what used to be in it, so `index/types.ts` → `recordRemovals` tallies rows about
to be deleted — split by flag — into the `removal` table before the sweep drops
them. Counts only, never anything about the photograph itself. The culling slide
therefore always says *since when* it has been watching, and never implies it
knows about deletions from before it was first run.

**`core/cities.ts`** puts a name to a pair of coordinates without a network
request — a short table, nearest match, and nothing at all past 120km. It also
holds `DEFAULT_CITY`, which is where a fresh config starts.

**Slide settings.** A choice that changes one slide travels with that slide:
`stats/slides.ts` attaches a `SlideSetting`, the deck renders it beside the
frame, and picking an option puts it in the `/api/deck` query and rebuilds. The
ids are the query parameter names — `yearBasis`, `daylight`, `rows.lenses` — so
adding a setting is a matter of emitting one and parsing it in `server/routes.ts`.
Row limits are resolved in exactly one place, `resolveLimits`, and ride on
`DeckStats.limits` so the slide and the chips beside it cannot disagree. A
setting shared by two slides is built by one function — `yearBasisSetting` — for
the same reason: the years slide and the streaks wall would look absurd
disagreeing about what a year is.

**`web/export.js`** — the PDF and the ZIP are both written by hand: one JPEG
XObject per page for the first, stored (never deflated) PNG entries for the
second, since a PNG is already compressed and deflating it again would mean
shipping a compressor. Byte offsets are tracked as chunks are appended, and
`test/export.test.ts` walks both directories checking every offset lands on the
thing it claims — a wrong one gives a blank document or an unopenable archive
rather than an error.

**Two ways to catch up with a change.** `core/db.ts` holds `INDEX_VERSION` and
`INDEX_CHANGES`; every source stores the version it was built under, and the
Sources list shows what re-indexing a stale one would add. Bump the version only
for changes that genuinely need a file re-read. Everything else belongs in
`index/repair.ts`, which runs at startup, is idempotent, and fixes rows in place
— the teleconverter split went in there precisely so nobody had to spend an hour
re-reading a library for it.

## Invariants worth not breaking

- A photograph is a `is_primary` row. Every count, in every slide, filters on
  it. A query that forgets is silently counting files.
- Re-indexing an unchanged folder opens **no files** — `test/index.test.ts`
  asserts `stats.read === 0`. Metadata is cached against `(size, mtime)`, and
  the sweep that nulls the derived columns for `pending` rows is what keeps a
  changed file from being counted with its old numbers.
- The colours in `web/theme.js` are the validated categorical palette; slot
  order is the colour-blind-safety mechanism, not decoration. Assign by slot,
  never cycle, and run the palette validator before changing a hex. Past the
  eighth slot `seriesColour` *generates* one: golden-angle hues, then a search
  over hue and lightness candidates scored on OKLab distance from the previous
  colour through normal vision and simulated protanopia, deuteranopia and
  tritanopia. All 25 clear every hard gate of the validator in both modes — the
  worst adjacent pairs are still the documented ones. Never assign a generated
  colour to anything but a series, and never let one displace a documented slot.
- **The palette is the reader's, and sparse.** `AppConfig.palette` holds only
  the roles they have actually changed, per mode — storing the whole thing would
  freeze today's defaults into every config and stop anyone who never opened the
  panel from getting improvements to it. `PALETTE_ROLES` in `core/config.ts` is
  the single list of what is offered: it names roles by their *job*, is sent to
  the page in `appState` rather than duplicated there, and is what
  `coercePaletteSide` validates against. `themeFor(mode, override)` in
  `web/theme.js` is the only place that knows `series.3` means
  `theme.series[3]`. Generated colours past the eighth slot are cached against
  the palette that produced them, never against the mode alone — they are
  *searched for* relative to the slots already in use, so a mode-keyed cache
  hands a ninth lens a colour chosen for somebody else's palette.
- **`paletteProblems` warns, and never blocks.** Colour-blind safety is a
  property of the set, not of any colour in it, so the gates are the palette
  validator's own: adjacent pairs at ΔE ≥ 6 through `min(protan, deutan)`, a
  normal-vision floor of 15, a heat ramp that climbs one way in steps of ≥ 0.06
  lightness. Tritanopia is measured but not gated — the shipped palette trips it
  at ΔE 5.6. The gate uses the Machado (2009) matrices because the thresholds
  were calibrated against them; the generator keeps the Viénot ones it was tuned
  with, and the comment there says so. The first thing the tests check is that
  the shipped palette raises no warning: a warning nobody can act on teaches
  people to ignore the ones that matter.
- Every slide carries a `table`, and the deck's `t` view renders it. Three of
  the light-mode series colours sit below 3:1 against the surface, so a value
  reachable only by colour is a defect.
- `buildDeck` drops slides with nothing to say rather than rendering them empty,
  and returns a one-slide "nothing here yet" deck for an empty range.
- **A chart may summarise; a table may not.** `stats/aggregate.ts` returns full
  lists and `stats/slides.ts` does the top-N-plus-"others" folding for the bars
  only. The table carries every row, including hidden gear, with a `RowKey` so
  it can be switched back on.
- Hiding a camera or lens removes its frames from *every* query, via `scope()`.
  The one exception is the pair of queries that list the hidden gear itself,
  which pass `hideGear: false` — a hidden row nobody can see is a hidden row
  nobody can restore.
- **A milestone points at gear by key, never by name.** `Anchor.gear` holds a
  `camera.key` / `lens.key` — or `photo.tc` for a converter — so the thing it
  refers to survives a rename, a naming setting, and a second source spelling it
  differently. `stats/aggregate.ts` → `gearCatalog` is the list the picker
  offers and the list `POST /api/anchors` validates against; a key that is not
  in it is refused rather than saved to fail quietly later. The list is
  deliberately *not* scoped to a range, a start day or the exclusions: gear you
  have hidden from the deck is still gear you bought. Old milestones carry no
  category at all and must keep working — `coerceAnchor` degrades anything it
  does not recognise to a plain dated label rather than dropping it.
- **A milestone annotates; it never becomes a series.** `Mark`s ride on
  `Slide.marks` and only the renderers that draw time read them, as a dashed
  hairline in `ink2` with a name where one fits — never a colour from the
  palette, which belongs to the data. Which of them get named is decided by the
  same collision rule the column labels use, and on the wall of days the year
  labels claim their space first: knowing which year you are looking at comes
  before knowing which week a lens arrived. Drawing them at all is a slide
  setting — `marks.timeline`, `marks.streaks`, `marks.months` — resolved in one
  place, `resolveMarks`, and built by one function so three chips cannot drift
  apart in wording. The *defaults* differ deliberately: a mark costs month by
  month nothing and costs the wall of days a square, so the months start
  annotated and the wall starts clean.
- **A bar chart's orientation is the reader's, and its default is the slide's.**
  `Slide.orientation` is set from `layout.<slide id>` and every renderer that
  draws bars branches on it — `drawBars` → `drawBarsAsColumns`, `drawColumns` →
  `drawColumnsAsRows`, `drawMonths` → `drawMonthColumns`, `drawWeek` →
  `drawWeekAsRows`. The *natural* orientation lives with the slide that builds
  it, never in the renderer, so "what does this draw when nobody has said" has
  one answer in one place. Both halves are checked in every format and both
  themes: the flipped one is the half nobody looks at, and a label gutter that
  eats the plot is invisible to a bounds check.
- **The wall of days has three shapes and one legend.** `WallLayout` is
  `packed` (weeks wrapped into as many bands as make the squares biggest),
  `years` (a row each) or `months` (a block per month, days under their
  weekdays, Monday first like every other weekday axis here). `streaksSlide`
  offers only the ones the range can hold — a row per year needs two years, a
  block per month needs two months — and falls back to `packed` rather than
  drawing an empty wall when a setting outlives the range it was chosen in. The
  key is built by `stripKey` and measured by `stripLegendHeight` before
  anything is drawn: it wraps onto a second line on a 9:16 frame, and a layout
  that reserved one line would be drawn underneath it. Text has no box, so no
  bounds check can catch that.
- **Only months holding photographs are rows** on `drawMonths`, so the axis is a
  run of months rather than a ruler: two years can be neighbours. `monthRow`
  puts a day that falls in a month nobody shot on the boundary between the two
  either side of it rather than dropping it, because a camera bought and then
  not touched for a fortnight is exactly the mark worth having.
- A teleconverter is stored beside the lens (`photo.tc`), never inside its name.
  One lens is one row and one bar; the converter is a shade within it. The key
  is computed from the optics with the converter stripped, so bare and converted
  frames land in the same bucket by construction.
- Footnotes are a phrase, not a paragraph, and never a count of frames or a word
  about hidden gear — `test/slides.test.ts` enforces both. Denominators live in
  the table view, which carries every value anyway. A slide with nothing to add
  has no note, and `frame()` gives that space back to the chart.
- No number appears twice on one slide. A hero's headline says in words what its
  big number says in digits, and the tiles under it carry the numbers it does not.
- `config.startDay` is applied in `resolveRange`, not in the SQL, so one place
  decides what a range means. `Range.clipped` is how the opening slide knows to
  say the start date is holding it back.

## Testing

```bash
npm test          # 273 tests
npm run typecheck
npm run fixtures -- ./fixtures
```

`tools/exif-writer.ts` synthesises real APP1/TIFF blocks and real MP4 boxes, so
fixtures carry genuine metadata rather than committed binaries;
`tools/make-catalog.ts` writes a real (tiny) Lightroom catalog. The fixtures
deliberately encode the failure modes: a raw + JPEG shoot, a burst, a backup
copy of five frames, a crop body whose 35mm equivalent matters, clips whose only
metadata is a `moov`, and a shoot in the previous year. Check `EXPECTED` in
`tools/make-fixtures.ts` still describes reality before editing a test to agree
with new output.

`test/render.test.ts` runs the drawing code against a DOM shim, in every format,
and checks for `NaN` coordinates, marks outside the frame, and text baselines
too close together — all three are invisible failures in a browser, and the last
one is the bug that produced the first round of feedback on this tool.

## Gotchas

- `node:sqlite` emits an ExperimentalWarning during module-graph instantiation,
  before any user code runs — it cannot be suppressed from inside the process.
  `--disable-warning=ExperimentalWarning` in the shebang and npm scripts is the
  only thing that works.
- `node --test test/` treats the path as a module; use `"test/*.test.ts"`.
- `node:sqlite` returns null-prototype row objects, so `assert.deepEqual`
  against an object literal fails; map the fields first.
- Lightroom catalog schemas drift between versions. `index/lightroom.ts` probes
  every optional table and column before use — keep new fields optional. It also
  stores aperture and shutter as APEX logarithms, converted in `core/units.ts`.
- Capture times are timezone-free `YYYYMMDDHHMMSS` integers, never epochs. See
  the header of `core/time.ts`; `epoch_sec` exists alongside them only so gaps
  between frames are arithmetic.
- The server exposes filesystem browsing, hence the loopback bind plus `Host`
  header check in `server/server.ts`. Don't relax either.
- `src/web/*.js` carries `// @ts-check` for the editor, but is not in the
  `tsconfig` program — same convention as the sibling `can-i-format` project.
- **A class that sets a `display` beats the browser's own `[hidden]`.** Anything
  hidden from script needs a `.class[hidden] { display: none }` rule of its own,
  or it never goes away — no error, nothing wrong-looking in the source, the
  thing simply sits there. `test/page.test.ts` walks the stylesheet against the
  markup and fails if one is missing.
- Draw in slide coordinates, never inside a `<g transform>`. `test/render.test.ts`
  reads x/y/width/height straight off the elements to check nothing leaves the
  frame, and a transform hides the real position from it — a shape that has been
  moved somewhere invisible would still pass. The thumbs on the culling slide
  turn over by mirroring their unit box into absolute points, not by a `scale`.
