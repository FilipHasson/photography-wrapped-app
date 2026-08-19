# Photography Wrapped

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
npm test                     # 145 tests, including a full index-and-count run
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

### How gear is named

Gear names are written when a deck is built, not when a file is indexed, so
changing any of this re-labels a library of two hundred thousand photographs
instantly and re-reads nothing:

- **Lens names — short or as written.** Short drops what nobody says out loud:
  `FE 200-600mm F5.6-6.3 G OSS` becomes `FE 200-600mm G`, and
  `FE 70-200mm F2.8 GM OSS II` becomes `FE 70-200mm GM II`. Series marks
  (`G`, `GM`, `L`, `S`, `Art`) and version numerals stay, because those
  are what people do say.
- **The maker in front, or not.** `Sony FE 24-70mm GM II` or
  `FE 24-70mm GM II`; `Sony a9 III` or `a9 III`.

Grouping never depends on any of it — the key is the name the camera wrote — so
a display setting can never merge or split two pieces of kit.

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

Twenty-one slides at most, and only the ones that have something to say — no GPS
in your library means no map, no ratings means no keepers slide.

Opening totals · year by year · cameras · lenses · **camera + lens pairings** ·
focal length · aperture · ISO · shutter speed · time of day · day of the week ·
a calendar of every day · streaks · which lens was on the camera month by month ·
culling · keepers · format and orientation · where · new gear · your longest
burst · a closing summary.

A few things the slides do rather than say:

- **The clock is coloured by the time of day** — cool at midnight, warm at
  midday. Tell it where you are (Settings, or one click of **Use my location**)
  and the light turns at the real sunrise and sunset for that latitude; the
  slide says which hours it used, and a setting beside it offers fixed windows
  instead. Your own position, not the GPS in your photographs — a fortnight
  abroad should not decide what "after dark" means for a year shot at home.
- **Streaks is a wall of days**, one square each: blue where you shot, blank
  where you did not, a lighter blue through your longest run and red through the
  longest silence. Days either side of the range are drawn as empty outlines, so
  a part-week at each end reads as "not asked about" rather than as a gap. It
  packs itself into as many rows as make the squares biggest and labels where
  each year starts; a setting gives every year a row of its own instead, and
  another decides whether a year runs from January or from your start date.
- **Culling counts flags, not stars** — picked, rejected, and the ones you never
  went back to. It also counts what has actually *left*: a photograph deleted
  from a catalog leaves no trace in it, so the index counts what disappears each
  time it sweeps, and the slide says how long it has been watching.
- **Day of the week starts where you do** — Monday, Sunday or Saturday — and the
  weekend can be given a colour of its own.
- **A lens used with a teleconverter is one row, not three.** The bar splits
  into shades: bare glass, then a shade per converter — on the lens slide, on
  pairings, and inside each month of the gear-over-time chart.
- **Two or three cameras stand up as columns** instead of lying down as short
  bars in an empty frame.
- **Keepers carries a figure for everything never rated**, which is usually most
  of a library and would flatten the five star columns if it were a sixth.

| Key | Does |
|---|---|
| `→` `←` `space` | Next and previous slide |
| `a` | **All slides** — the whole deck on one page |
| `t` | **Data** — the table behind the slide you are looking at |
| `f` | Full screen |
| `Esc` | Back to the library |

### Where you are

**Settings → Where you are** takes one click of **Use my location** (or typed
coordinates), and names the position from a table of cities compiled in — no
request is made, here or anywhere else. It starts on Toronto. Sunrise and sunset
on the time-of-day slide come from it.

### Settings that belong to one slide

Some choices change one slide and nothing else, so they sit beside it rather
than in a panel of library-wide settings: whether a year runs from January or
from the day your library starts, which hours the clock counts as daylight, and
**how many rows a chart draws before it pools the rest into "everything else"**.
Every slide that folds a tail away offers that last one — cameras, lenses,
pairings, and the gear-over-time chart, which goes up to twenty-five: past the
eight documented palette slots the colours are generated by a search that keeps
each new one as far as possible from its neighbour, through normal vision and
through the three kinds of colour blindness. Twenty-five colours cannot all be
told apart by hue whoever picks them, so the legend, the hover labels and the
table carry the identity that colour cannot.

Changing one rebuilds the deck from the database and comes straight back to the
slide you were on.

### All slides at once

**All slides** (or `a`) lays the whole deck out as a contact sheet, sized so it
fits the window in one screenshot — the column count is worked out from the
shape you have chosen and the room there is. Click any of them to go to that
slide.

### Data, and hiding what skews them

**Data** is not a fallback. Every value a slide draws is in its table, so
nothing on a slide is reachable only by colour — and the table goes further than
the chart does. Where a chart folds a tail into one "12 others" bar, the table
lists all twelve, and where a slide draws a percentage it is the table that says
how many frames carried the field it divided by.

Each row of gear also has a tick box. Untick it and that camera or lens leaves
**every count on every slide**, not just the chart in front of you — which is
what you want for the single iPhone frame that found its way into a catalog and
turned into a camera. The row stays in the table, marked hidden, so you can put
it back. The choice is saved.

### Shapes, and saving it

The deck draws itself at whatever shape you pick, and the choice sticks:

| | For |
|---|---|
| **9:16** | **Stories and Reels — the default** |
| **4:5** | A feed post — the tallest the grid allows |
| **1:1** | Square |
| **4:3** | A grid post |
| **16:9** | Screens, projectors, the PDF |

It is a real re-layout rather than a crop, and 9:16 is the one it is designed
for. Type is set *larger* relative to the frame as the frame narrows, because a
label that is comfortable across a laptop is a third of the apparent size on a
phone. Ranked bars put the lens name above its own bar instead of beside it. The
calendar tiles itself as a grid of months, sized to whatever room it has: a
monthly report becomes one big month, a year becomes twelve small ones. The map
frames itself on your photographs rather than on the world, so a year spent
within fifty miles of home is not four dots in an empty rectangle.

- **Slide (PNG)** — the slide you are on, at twice the format size
  (9:16 comes out 2160×3840).
- **Deck (PDF)** — every slide, one page each, at the format's aspect ratio.
- **Deck (PNGs)** — a ZIP with one numbered PNG per slide, ready to post one at
  a time.

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

## Keeping an index up to date

Two things happen when this tool changes under an index you already built.

**What can be fixed in place, is.** A repair pass runs at startup and rewrites
what it can without opening a file — when teleconverters became part of the
model, for instance, the lens rows that had a converter in their *name* were
folded back into the lens they belong to, and every frame gained the converter
it was taken through. It is idempotent, it takes milliseconds, and it prints a
line when it does something.

**What cannot be fixed in place is versioned.** Each source records the index
format it was last built under. When the running code writes a newer one, the
source is marked in the Sources list with what re-indexing it would add — not a
nag, a reason:

> **older index** · Re-index for teleconverters read from each frame, and gear
> names kept exactly as the camera wrote them.

A source below the current version still works. It is just missing whatever that
version learned to read.

## When numbers look wrong

- **Nothing changed after an update.** Check the terminal: a second copy of the
  tool holding the port used to make this tool move quietly to another one,
  leaving a browser tab served by the old copy. It now refuses to start instead.
- **Fewer photographs than files.** That is the point — see the table above.
  The opening slide says how many files those photographs came from.
- **"Known for 8,000 of 16,000 frames."** Some cameras, and most exports,
  write no lens or no exposure data. Slides say what they had rather than
  quietly changing the denominator.
- **A lens listed twice.** Two spellings that normalisation did not merge.
  `src/core/gear.ts` is where that lives, and `test/gear.test.ts` is where a
  new case goes.
- **A camera named like a part number.** Several makers write service codes
  rather than names, and they are rewritten to what people say:

  | Written as | Shown as |
  |---|---|
  | `ILCE-7M2`, `DSC-RX100M7` | Sony a7 II, Sony RX100 VII |
  | `DC-S5M2`, `DMC-GH4` | Lumix S5 II, Lumix GH4 |
  | `SM-S928B`, `SM-A546E` | Galaxy S24 Ultra, Galaxy A54 |
  | `E-M1MarkIII` | Olympus E-M1 Mark III |
  | `PENTAX K-3 Mark III` under make `RICOH IMAGING COMPANY, LTD.` | Pentax K-3 Mark III |
  | `iPhone 15 Pro` under make `Apple` | iPhone 15 Pro — the maker is not said twice |

  A code with no rule behind it — DJI's `FC3582`, an unlisted Samsung flagship —
  keeps the code it came with rather than being guessed at. All of this is
  display only: the grouping key is the model as written, so renaming can never
  merge two bodies. Add a case in `src/core/gear.ts`, with a test row in
  `test/gear.test.ts`.
- **Everything in one year, decades ago.** A camera with a dead clock battery.
  Capture times before 1990 are treated as unknown; a stuck clock inside that
  range is believed.
