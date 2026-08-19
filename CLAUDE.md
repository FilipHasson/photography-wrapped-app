# What did I shoot? — working notes

Counts a photography library and turns the counts into slides. See `README.md`
for user-facing behaviour. This file is the map for changing it.

## Ground rules

1. **Read-only, always.** Photographs are opened for their headers and never
   written to; a Lightroom catalog is copied before it is read. Any path that
   modifies, moves or deletes media is wrong by construction.
2. **Never claim more than was counted.** Every distribution reports how many
   frames actually carried the field, and slides say so. Inventing a
   denominator is the one bug that makes the whole deck untrustworthy.
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

**Slide settings.** A choice that changes one slide travels with that slide:
`stats/slides.ts` attaches a `SlideSetting`, the deck renders it beside the
frame, and picking an option puts it in the `/api/deck` query and rebuilds. The
ids are the query parameter names — `yearBasis`, `daylight`, `rows.lenses` — so
adding a setting is a matter of emitting one and parsing it in `server/routes.ts`.
Row limits are resolved in exactly one place, `resolveLimits`, and ride on
`DeckStats.limits` so the slide and the chips beside it cannot disagree.

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
  never cycle, and run the palette validator before changing a hex. Eight slots
  is the whole palette and therefore the cap on series in one chart (`MAX_SERIES`);
  a ninth lens is "Everything else", never a ninth hue.
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
- A teleconverter is stored beside the lens (`photo.tc`), never inside its name.
  One lens is one row and one bar; the converter is a shade within it. The key
  is computed from the optics with the converter stripped, so bare and converted
  frames land in the same bucket by construction.
- Footnotes are a phrase, not a paragraph. Anything needing a sentence to
  explain belongs in the table view, which carries every value anyway.
- `config.startDay` is applied in `resolveRange`, not in the SQL, so one place
  decides what a range means. `Range.clipped` is how the opening slide knows to
  say the start date is holding it back.

## Testing

```bash
npm test          # 134 tests
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
