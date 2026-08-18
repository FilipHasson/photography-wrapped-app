# What did I shoot?

Point it at your photographs and it counts them, then hands you a deck of
slides: **your most-used lens, your most-used body, the pairing you actually
reach for**, the focal length you keep coming back to, when you shoot, how
often, and where.

Ask it for a month and it is a monthly report. Ask it for a year and it is a
wrapped. Ask it for everything and it is the shape of your photography so far.

> Nothing is written to your photographs, ever. Files are opened read-only for
> their headers, a Lightroom catalog is copied before it is read, and nothing
> leaves the machine — there is no network call anywhere in this tool.

---

## Quick start

Requires **Node 24 or newer** (it uses the built-in SQLite module and runs
TypeScript directly — there is no build step).

```bash
npm install
npm start
```

A browser opens on `http://127.0.0.1:4112`. Add a source, wait for the index,
pick a range, and hit **Show me the deck**.

```
npm start -- --port 8080     # a different port
npm start -- --no-open       # don't launch a browser
npm test                     # 91 tests, including a full index-and-count run
npm run typecheck
```

## What a source is

Anywhere your photographs live. Add as many as you like:

- **A folder tree** — your Pictures directory, an archive drive, a NAS mount.
  Every photograph's header is read once and cached against its size and
  modification time, so the second index of a large library reads nothing.
- **A Lightroom Classic catalog** (`.lrcat`) — read directly, without opening a
  single image. The catalog already holds camera, lens, focal length, aperture,
  shutter, ISO and GPS for everything it has imported, which makes it
  enormously faster than a folder scan. It is also the only place **ratings and
  flags** live, so it is what makes a keeper-rate slide possible.

Adding both is the normal thing to do, and is handled — see below.

## What counts as a photograph

Counting files would be wrong three ordinary ways, so it counts *frames*:

| Situation | What happens |
|---|---|
| You shoot raw + JPEG | One press of the shutter, one photograph. The raw file is the one kept. |
| Your Pictures folder **and** the catalog that indexed it are both sources | One photograph, described twice. The catalog's ratings and the file's size are merged onto the survivor. |
| A backup drive holds the same shoot again | One photograph. Same body, same instant, same frame number. |
| A 20fps burst | Twenty photographs. The camera numbered them separately, so they are separate. |

A frame's identity is `body + wall-clock second + the name the camera gave it`.
Sub-second EXIF times would be the obvious thing to key on, and are deliberately
not used: a Lightroom catalog does not store them, so keying on them would count
every raw + JPEG pair twice for anyone who added a folder and its catalog.

If you would rather count files, turn off **Count raw + JPEG as one
photograph** in Settings; duplicate *paths* still collapse.

## Ranges

The same deck, over whatever span you ask for:

- **All time** — everything in the index
- **A year** — 2025, 2024, … built from the years you actually shot in
- **A month** — the last six months are one click; any month via the dates
- **Last 30 days**, **last 12 months**
- **Any two dates** — from and to, inclusive
- **Since a milestone** — see below

Every range except all-time also carries the equally long window before it, so
the opening slide can tell you whether you shot more or less than last time.

### Milestones and where your library starts

A catalog usually reaches back further than the photography does — phone snaps,
scans, an old import — and one such year moves every average and every
"favourite" in an all-time deck.

Two settings deal with that, and both are saved:

- **My library starts on** — a date before which nothing is counted, in *every*
  range including all-time. Set it to the day you bought the camera and the
  phone years stop existing as far as the deck is concerned. The opening slide
  says so out loud whenever it is holding a range back.
- **Milestones** — named dates worth measuring from ("Bought the a9 III",
  "Moved to Lisbon"). Each becomes a one-click **Since …** range of its own, and
  any of them can be promoted to the library start date with one button.

## The deck

Seventeen slides at most, and only the ones that have something to say — no GPS
in your library means no map, no ratings means no keepers slide.

Opening totals · cameras · lenses · **camera + lens pairings** · focal length ·
aperture · ISO · shutter speed · time of day · day of the week · a calendar of
every day · which lens was on the camera month by month · keepers · format and
orientation · where · new gear · your longest burst · a closing summary.

| Key | Does |
|---|---|
| `→` `←` `space` | Next and previous slide |
| `t` | **Numbers** — the table behind the slide you are looking at |
| `f` | Full screen |
| `Esc` | Back to the library |

### Numbers, and hiding what skews them

**Numbers** is not a fallback. Every value a slide draws is in its table, so
nothing on a slide is reachable only by colour — and the table goes further than
the chart does. Where a chart folds a tail into one "12 others" bar, the table
lists all twelve.

Each row of gear also has a tick box. Untick it and that camera or lens leaves
**every count on every slide**, not just the chart in front of you — which is
what you want for the single iPhone frame that found its way into a catalog and
turned into a camera. The row stays in the table, marked hidden, so you can put
it back. The choice is saved.

### Shapes, and saving it

The deck draws itself at whatever shape you pick, and the choice sticks:

| | For |
|---|---|
| **16:9** | Screens, projectors, the PDF |
| **9:16** | Stories and Reels |
| **4:5** | A feed post — the tallest the grid allows |
| **4:3** | A grid post |
| **1:1** | Square |

It is a real re-layout rather than a crop: type is set larger relative to the
frame in the narrow shapes, ranked bars put the lens name above its own bar
instead of beside it, and the year calendar turns ninety degrees so weeks run
down the frame instead of across it.

- **Save slide (PNG)** — the slide you are on, at twice the format size
  (9:16 comes out 2160×3840).
- **Save deck (PDF)** — every slide, one page each, at the format's aspect ratio.

Both are rendered from the slides themselves rather than from the screen, so
what you save is what you saw, at full resolution, in the theme you are using.

## From the terminal

Useful for a monthly report you would rather not click through:

```bash
npm start -- index                  # index every source and exit
npm start -- index --full           # re-read every file, ignoring the caches
npm start -- stats --month 2025-03  # print the headlines
npm start -- stats --year 2025
npm start -- stats --last 30
npm start -- stats --from 2025-01-01 --to 2025-03-31
```

## What it reads, and what it does not

It reads image headers — EXIF for stills, the `moov` box for video — and never
the picture data. It writes exactly two things, both under your config
directory: `config.json` and `index.db`.

The local server binds to loopback only and refuses any request whose `Host`
header is not local, because it can browse your filesystem for the source
picker. It is not a service to expose.

## When numbers look wrong

- **Fewer photographs than files.** That is the point — see the table above.
  The opening slide says how many files those photographs came from.
- **"Known for 8,000 of 16,000 frames."** Some cameras, and most exports,
  write no lens or no exposure data. Slides say what they had rather than
  quietly changing the denominator.
- **A lens listed twice.** Two spellings that normalisation did not merge.
  `src/core/gear.ts` is where that lives, and `test/gear.test.ts` is where a
  new case goes.
- **A camera named like a part number.** Sony writes `ILCE-7M2` where everyone
  else writes a name; those are rewritten to `a7 II` by rule, so the whole
  shelf reads the same way. The grouping key is still the raw model, so the
  renaming can never merge two bodies.
- **Everything in one year, decades ago.** A camera with a dead clock battery.
  Capture times before 1990 are treated as unknown; a stuck clock inside that
  range is believed.
