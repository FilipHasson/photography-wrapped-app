#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// The flag above silences the one-off notice that `node:sqlite` is
// experimental. It has to be a process flag: static imports load `node:sqlite`
// while the module graph is being instantiated, before any of our code has run
// and could intercept the warning.
//
// UV_THREADPOOL_SIZE is raised before anything touches the filesystem — the
// walker and the metadata reader are both bounded by libuv's thread pool, and
// the default of 4 leaves most of a fast disk's throughput unused.
process.env.UV_THREADPOOL_SIZE ??= "16";

import { spawn } from "node:child_process";
import { loadConfig } from "./core/config.ts";
import { openDb, closeDb } from "./core/db.ts";
import { configFile, dbFile } from "./core/paths.ts";
import { indexSource, indexOverview } from "./index/source.ts";
import { repairIndex } from "./index/repair.ts";
import { computeStats } from "./stats/aggregate.ts";
import { buildDeck } from "./stats/slides.ts";
import { parseRangeSpec, resolveRange, type RangeSpec } from "./stats/range.ts";
import { parseIsoDay } from "./core/time.ts";
import { startServer } from "./server/server.ts";

interface Args {
  command: "serve" | "index" | "stats";
  port?: number;
  open: boolean;
  full: boolean;
  help: boolean;
  range: RangeSpec;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { command: "serve", open: true, full: false, help: false, range: { kind: "all" } };
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--no-open") args.open = false;
    else if (arg === "--full") args.full = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--port" || arg === "-p") {
      const value = Number(argv[++i]);
      if (Number.isFinite(value)) args.port = value;
    } else if (arg === "--year") {
      const year = Number(argv[++i]);
      if (Number.isInteger(year)) args.range = { kind: "year", year };
    } else if (arg === "--month") {
      // `--month 2025-03`, the same shape a report is usually named after.
      const [year, month] = String(argv[++i] ?? "").split("-").map(Number);
      if (Number.isInteger(year) && Number.isInteger(month)) {
        args.range = { kind: "month", year: year as number, month: month as number };
      }
    } else if (arg === "--last") {
      const days = Number(argv[++i]);
      if (Number.isFinite(days)) args.range = { kind: "last", days };
    } else if (arg === "--from" || arg === "--to") {
      const day = parseIsoDay(String(argv[++i] ?? ""));
      const current = args.range.kind === "custom" ? args.range : { kind: "custom" as const, from: 0, to: 0 };
      if (day !== null) {
        args.range = {
          kind: "custom",
          from: arg === "--from" ? day : current.from || day,
          to: arg === "--to" ? day : current.to || day,
        };
      }
    } else if (arg && !arg.startsWith("-")) {
      rest.push(arg);
    }
  }

  const command = rest[0];
  if (command === "index" || command === "stats") args.command = command;
  return args;
}

const HELP = `photography-wrapped — turn your photography library into a deck of stats

  Usage: photography-wrapped [command] [options]

  Commands:
    (none)           Open the deck in a browser
    index            Index every enabled source and exit
    stats            Print the headlines to the terminal and exit

  Range (for stats):
        --year 2025          One calendar year
        --month 2025-03      One month
        --last 30            The last 30 days
        --from 2025-01-01 --to 2025-03-31
                             Any span you like
    (default)                Everything in the index

  Options:
    -p, --port <n>   Port for the local UI (default: from config, else 4112)
        --no-open    Do not launch a browser
        --full       Re-read every file when indexing, ignoring caches
    -h, --help       Show this message

  Config: ${configFile()}
  Index:  ${dbFile()}

Nothing here writes to your photographs. Files are opened read-only, for their
headers, and never modified.`;

function openBrowser(url: string): void {
  const [command, commandArgs] =
    process.platform === "win32"
      ? ["cmd.exe", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];

  try {
    // Detached and ignored: the browser must not hold this process open or
    // spill its output into the terminal.
    spawn(command, commandArgs, { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {
    // Headless boxes have no browser; the URL is printed either way.
  }
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const config = await loadConfig();
if (args.port !== undefined) config.port = args.port;
const db = openDb();

// Rules that changed after an index was built are applied once, here, rather
// than asking anyone to re-read a library because of them.
const repaired = repairIndex(db);
if (repaired.teleconverters > 0) {
  const entries = repaired.teleconverters === 1 ? "entry" : "entries";
  console.log(
    `\n  Folded ${repaired.teleconverters} teleconverter ${entries} back into the lenses they belong to.`,
  );
}

if (args.command === "index") {
  const sources = config.sources.filter((source) => source.enabled);
  if (sources.length === 0) {
    console.log("No sources configured yet. Run without a command and add one from the page.");
    process.exit(1);
  }

  for (const source of sources) {
    process.stdout.write(`\n  ${source.label}  (${source.path})\n`);
    let lastLine = "";
    const stats = await indexSource(db, source, config, {
      mode: args.full ? "full" : "incremental",
      onProgress: (progress) => {
        const line =
          progress.total > 0
            ? `  ${progress.message ?? progress.phase}: ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`
            : `  ${progress.message ?? progress.phase}: ${progress.files.toLocaleString()} files`;
        if (line === lastLine) return;
        lastLine = line;
        process.stdout.write(`\r${line.padEnd(78)}`);
      },
    });
    process.stdout.write(
      `\r  ${stats.files.toLocaleString()} files, ${stats.added.toLocaleString()} new, ` +
        `${stats.read.toLocaleString()} read, ${(stats.durationMs / 1000).toFixed(1)}s`.padEnd(78) + "\n",
    );
    for (const error of stats.errors.slice(0, 5)) {
      console.log(`    ! ${error.path}: ${error.message}`);
    }
  }

  const overview = indexOverview(db);
  console.log(`\n  ${overview.shots.toLocaleString()} photographs indexed.\n`);
  closeDb();
  process.exit(0);
}

if (args.command === "stats") {
  const overview = indexOverview(db);
  const range = resolveRange(args.range, {
    firstDay: overview.firstDay,
    lastDay: overview.lastDay,
    floorDay: config.startDay,
  });
  const stats = computeStats(db, range, {
    includeVideo: config.includeVideo,
    excluded: config.excluded,
    naming: config.naming,
    anchorDay: config.startDay ?? overview.firstDay,
  });
  const deck = buildDeck(stats, config.ownerName);

  console.log(`\n  ${deck.title}  ·  ${deck.rangeLabel}\n`);
  for (const slide of deck.slides) {
    console.log(`  ${slide.title}`);
    console.log(`    ${slide.headline}`);
    if (slide.note) console.log(`    ${slide.note}`);
    console.log("");
  }
  closeDb();
  process.exit(0);
}

const server = await startServer(db, config);

console.log(`\n  Photography Wrapped  ${server.url}\n`);

// Silently moving to a free port is how you end up with a browser tab on an
// older copy of the tool, wondering why a feature you just added is missing.
if (server.movedPort) {
  console.log(
    `  Port ${config.port} was taken, so this copy is on ${server.port}. Another copy is
  probably still running: close it, and reload anything pointing at
  http://127.0.0.1:${config.port} — that tab is being served by the old one.\n`,
  );
}

if (config.sources.length === 0) {
  console.log("  No sources yet — the page will walk you through adding one.\n");
}

if (args.open) openBrowser(server.url);

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await server.close().catch(() => {});
  closeDb();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
