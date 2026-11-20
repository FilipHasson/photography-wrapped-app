# Photography Wrapped

Counts the photographs in your folders and Lightroom catalogs and turns them
into a deck of slides: your most-used lens and body, the focal lengths you keep
coming back to, when and how often you shoot, and where. Ask for a month and it
is a monthly report; ask for a year and it is a wrapped.

It never writes to a photograph, and nothing leaves your machine.

## Download

Get the latest Windows build from the
[releases page](https://github.com/FilipHasson/photography-wrapped-app/releases/latest):
download `Photography-Wrapped-win32-x64.zip`, unzip it and run
`Photography Wrapped.exe`. Add a source, wait for the index, pick a range and
press **Show me the deck**.

## Development

### Requirements

Node 24 or newer. It uses Node's built-in SQLite and runs the TypeScript
sources directly, so there is no build step.

```bash
npm install
```

### Running it

```bash
npm run app                 # in its own window (Electron)
npm start                   # in your browser, at http://127.0.0.1:4112
npm start -- --port 8080    # on another port
npm start -- --no-open      # without opening a browser
npm run dev                 # the browser UI, restarting on every source change
```

From the terminal, without the UI:

```bash
npm start -- index                  # index every source and exit
npm start -- index --full           # re-read every file, ignoring the caches
npm start -- stats --year 2025      # print the deck's headlines
npm start -- stats --month 2025-03
npm start -- stats --from 2025-01-01 --to 2025-03-31
```

All of them share one config and index, in `%APPDATA%\what-did-i-shoot` on
Windows, `~/Library/Application Support/what-did-i-shoot` on macOS and
`~/.config/what-did-i-shoot` on Linux. Set `WHAT_DID_I_SHOOT_HOME` to a folder
of your own to keep a development copy apart from a real one.

### Testing

```bash
npm test             # the whole suite, including a full index-and-count run
npm run typecheck
npm run app:smoke    # boots the window against a throwaway install and screenshots it
npm run clean        # remove dist/, build/ and generated fixtures
```

`npm run fixtures -- ./fixtures` writes a small library to disk, with real EXIF
and a real Lightroom catalog, for trying the app by hand.

### Project layout

```
src/core/      config, SQLite, EXIF and video metadata, gear naming, units, dates
src/index/     reading folders and catalogs into the index, and deduplicating
src/stats/     ranges, the counting queries, and the words on each slide
src/server/    the local HTTP API and job runner
src/web/       the UI and the slide renderer: plain HTML, CSS and JavaScript
electron/      the desktop window around the same server
tools/         fixture generators and the icon
```

`CLAUDE.md` explains how counting, naming and drawing work and the rules the
code holds to. Read it before changing anything in `src/stats/` or
`src/web/chart.js`.

### Ground rules

- **Read-only, always.** Photographs are opened for their headers and never
  written to; a Lightroom catalog is copied before it is read.
- **Never claim more than was counted.** Every percentage divides by the frames
  that recorded the field, never by the whole library.
- **No network.** Nothing in the app makes a request, and the local server
  only answers on loopback.
- **No build step.** Only TypeScript syntax Node can strip (`npm run typecheck`
  enforces it), and the packaged app runs the same unbuilt sources.
- **One runtime dependency** (`exifr`). SQLite, the HTTP server and the PDF
  writer are built in.

### Packaging

```bash
npm run package     # dist/Photography Wrapped-win32-x64/Photography Wrapped.exe
```

Builds for the platform you run it on. Only Windows has been packaged and
tested; macOS and Linux need their own icon formats.

### Releasing

Push a version tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

`.github/workflows/release.yml` runs the typecheck and tests, packages the app,
and publishes `Photography-Wrapped-win32-x64.zip` as a GitHub Release.

The zip has the same name on every release, so
`/releases/latest/download/Photography-Wrapped-win32-x64.zip` always fetches
the newest build. The website's download button will depend on that, so don't
add a version number to the file name.

## Contributing

Issues and pull requests are welcome.

## License

[MIT](LICENSE). Use it, change it, ship it, sell it; keep the copyright notice
with it.
