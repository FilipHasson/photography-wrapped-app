import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import type { Db } from "../core/db.ts";
import {
  coercePlace,
  defaultSource,
  makeAnchor,
  makeKey,
  validateConfig,
  type AppConfig,
  type SourceConfig,
} from "../core/config.ts";
import { normPath } from "../core/paths.ts";
import { parseIsoDay } from "../core/time.ts";
import { indexSource, indexOverview, summarizeSources, INDEX_VERSION } from "../index/source.ts";
import { rebuildPrimaries } from "../index/dedupe.ts";
import {
  availableMonths,
  availableYears,
  computeStats,
  type DaylightMode,
  type RowLimits,
  type WeekStart,
} from "../stats/aggregate.ts";
import { buildDeck } from "../stats/slides.ts";
import { parseRangeSpec, resolveRange, type RangeSpec } from "../stats/range.ts";
import { browse } from "./browse.ts";
import type { JobManager } from "./jobs.ts";

export interface AppContext {
  db: Db;
  jobs: JobManager;
  config: AppConfig;
  saveConfig: (config: AppConfig) => Promise<void>;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1024 * 1024) throw new HttpError(413, "Request body too large.");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) throw new Error("expected an object");
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new HttpError(400, `Invalid JSON body: ${(err as Error).message}`);
  }
}

/** Everything the page needs to render its chrome, in one round trip. */
function appState(ctx: AppContext) {
  const problems = validateConfig(ctx.config);
  const overview = indexOverview(ctx.db);
  const floor = ctx.config.startDay;

  return {
    config: ctx.config,
    sources: summarizeSources(ctx.db).map((summary) => {
      const configured = ctx.config.sources.find((s) => s.key === summary.key);
      return { ...summary, configured: configured ?? null };
    }),
    /** Configured but never indexed — the page nudges these. */
    unindexed: ctx.config.sources.filter((s) => !ctx.db.getSource(s.key)).map((s) => s.key),
    overview,
    years: availableYears(ctx.db, floor),
    months: availableMonths(ctx.db, floor),
    problems,
    indexVersion: INDEX_VERSION,
    ready: overview.shots > 0,
    activeJob: ctx.jobs.active,
    platform: process.platform,
  };
}

/**
 * A saved anchor is addressed by id, not by the date and label it holds — the
 * label reaches the deck's title, and a label off a URL is a label anyone could
 * have written.
 */
function rangeSpecFor(ctx: AppContext, params: URLSearchParams): RangeSpec {
  if (params.get("range") === "anchor") {
    const anchor = ctx.config.anchors.find((a) => a.id === params.get("id"));
    if (anchor) return { kind: "since", day: anchor.day, label: anchor.label };
  }
  return parseRangeSpec(params);
}

async function addSource(ctx: AppContext, body: Record<string, unknown>): Promise<void> {
  const target = typeof body.path === "string" ? body.path.trim() : "";
  if (target === "") throw new HttpError(400, "A path is required.");

  const resolved = normPath(target);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat) throw new HttpError(400, `${resolved} does not exist.`);

  const isCatalog = resolved.toLowerCase().endsWith(".lrcat");
  if (isCatalog ? !stat.isFile() : !stat.isDirectory()) {
    throw new HttpError(400, isCatalog ? `${resolved} is not a file.` : `${resolved} is not a folder.`);
  }

  if (ctx.config.sources.some((s) => s.path === resolved)) {
    throw new HttpError(409, "That location is already one of your sources.");
  }

  const label = typeof body.label === "string" && body.label.trim() !== "" ? body.label.trim() : undefined;
  const taken = ctx.config.sources.map((s) => s.key);

  const source = defaultSource({
    path: resolved,
    ...(label ? { label } : {}),
  });
  source.key = makeKey(source.label, taken);

  ctx.config.sources.push(source);
  await ctx.saveConfig(ctx.config);
}

function requireSource(ctx: AppContext, key: string): SourceConfig {
  const source = ctx.config.sources.find((s) => s.key === key);
  if (!source) throw new HttpError(404, `No source called "${key}".`);
  return source;
}

async function applyConfigPatch(ctx: AppContext, body: Record<string, unknown>): Promise<boolean> {
  const next: AppConfig = { ...ctx.config };
  let dedupeChanged = false;

  if (typeof body.ownerName === "string") next.ownerName = body.ownerName.trim().slice(0, 60);
  if (typeof body.includeVideo === "boolean") next.includeVideo = body.includeVideo;

  // `startDay: null` clears it; anything unparseable is a mistake, not a clear.
  if (body.startDay === null) next.startDay = null;
  else if (typeof body.startDay === "string" && body.startDay !== "") {
    const day = parseIsoDay(body.startDay);
    if (day === null) throw new HttpError(400, `"${body.startDay}" is not a date.`);
    next.startDay = day;
  }
  if (typeof body.mergeRawJpegPairs === "boolean" && body.mergeRawJpegPairs !== next.mergeRawJpegPairs) {
    next.mergeRawJpegPairs = body.mergeRawJpegPairs;
    dedupeChanged = true;
  }
  if (body.lensStyle === "full" || body.lensStyle === "short") {
    next.naming = { ...next.naming, lensStyle: body.lensStyle };
  }
  if (typeof body.showMake === "boolean") next.naming = { ...next.naming, showMake: body.showMake };

  // `location: null` clears it; anything else has to be a real position.
  if (body.location === null) next.location = null;
  else if (body.location !== undefined) {
    const place = coercePlace(body.location);
    if (!place) throw new HttpError(400, "That is not a position on Earth.");
    next.location = place;
  }
  if (typeof body.port === "number" && Number.isFinite(body.port)) next.port = body.port;

  const problems = validateConfig(next);
  if (problems.length > 0) throw new HttpError(400, problems[0]?.message ?? "Invalid settings.");

  await ctx.saveConfig(next);
  return dedupeChanged;
}

function startIndexJob(ctx: AppContext, sources: SourceConfig[], mode: "incremental" | "full") {
  const label =
    sources.length === 1 ? `Indexing ${sources[0]?.label}` : `Indexing ${sources.length} sources`;

  return ctx.jobs.start("index", label, async (report, signal) => {
    const results: Record<string, unknown> = {};

    for (const source of sources) {
      if (signal.aborted) break;
      report({ message: `Indexing ${source.label}`, done: 0, total: 0 });

      results[source.key] = await indexSource(ctx.db, source, ctx.config, {
        mode,
        signal,
        onProgress: (progress) => {
          const detail =
            progress.total > 0
              ? `${progress.message ?? progress.phase} — ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}`
              : `${progress.message ?? progress.phase} — ${progress.files.toLocaleString()} files`;
          report({ message: `${source.label}: ${detail}`, done: progress.done, total: progress.total });
        },
      });
    }

    return results;
  });
}

export async function handleApi(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/")) return false;

  try {
    const route = `${req.method} ${url.pathname}`;

    if (route === "GET /api/state") {
      json(res, 200, appState(ctx));
      return true;
    }

    if (route === "GET /api/deck") {
      const overview = indexOverview(ctx.db);
      const range = resolveRange(rangeSpecFor(ctx, url.searchParams), {
        firstDay: overview.firstDay,
        lastDay: overview.lastDay,
        floorDay: ctx.config.startDay,
      });
      // Slide settings ride in the query alongside the range: they change what
      // the deck says, so they belong to the request rather than to the config.
      const yearBasis = url.searchParams.get("yearBasis") === "calendar" ? "calendar" : "anchor";
      const asked = url.searchParams.get("daylight") ?? "sun";
      const daylight: DaylightMode = ["sun", "06-18", "07-19", "05-21"].includes(asked)
        ? (asked as DaylightMode)
        : "sun";
      // `rows.lenses=20`: how many bars a slide draws before pooling the tail.
      // Nonsense is dropped here and clamped again in `resolveLimits`, so a
      // hand-typed query cannot ask for four hundred bars.
      const limits: RowLimits = {};
      for (const field of ["cameras", "lenses", "combos", "gear"] as const) {
        const asked = Number(url.searchParams.get(`rows.${field}`));
        if (Number.isFinite(asked) && asked >= 1) limits[field] = Math.floor(asked);
      }

      const asWeekStart = url.searchParams.get("weekStart");
      const weekStart: WeekStart =
        asWeekStart === "sun" || asWeekStart === "sat" ? asWeekStart : "mon";

      const stats = computeStats(ctx.db, range, {
        includeVideo: ctx.config.includeVideo,
        excluded: ctx.config.excluded,
        naming: ctx.config.naming,
        yearBasis,
        daylight,
        limits,
        // Where the reader is beats any GPS in the photographs: a trip abroad
        // should not decide what "after dark" means for a year shot at home.
        location: ctx.config.location,
        weekStart,
        markWeekend: url.searchParams.get("weekend") === "mark",
        // An anchor year starts where the library does; failing that, where the
        // photographs do.
        anchorDay: ctx.config.startDay ?? overview.firstDay,
      });
      json(res, 200, { range, deck: buildDeck(stats, ctx.config.ownerName) });
      return true;
    }

    if (route === "GET /api/browse") {
      json(res, 200, await browse(url.searchParams.get("path") ?? undefined));
      return true;
    }

    if (route === "POST /api/sources") {
      await addSource(ctx, await readJson(req));
      json(res, 200, appState(ctx));
      return true;
    }

    if (route === "POST /api/config") {
      const dedupeChanged = await applyConfigPatch(ctx, await readJson(req));
      if (dedupeChanged) {
        rebuildPrimaries(ctx.db, { mergeRawJpegPairs: ctx.config.mergeRawJpegPairs });
      }
      json(res, 200, appState(ctx));
      return true;
    }

    if (route === "POST /api/index") {
      const body = await readJson(req);
      const mode = body.mode === "full" ? "full" : "incremental";
      const keys = Array.isArray(body.sources)
        ? body.sources.filter((k): k is string => typeof k === "string")
        : null;

      const sources = keys
        ? keys.map((key) => requireSource(ctx, key))
        : ctx.config.sources.filter((s) => s.enabled);

      if (sources.length === 0) throw new HttpError(400, "No sources to index.");
      json(res, 200, { job: startIndexJob(ctx, sources, mode) });
      return true;
    }

    const sourceMatch = url.pathname.match(/^\/api\/sources\/([^/]+)$/);
    if (sourceMatch && req.method === "DELETE") {
      const key = decodeURIComponent(sourceMatch[1] as string);
      requireSource(ctx, key);
      ctx.config.sources = ctx.config.sources.filter((s) => s.key !== key);
      await ctx.saveConfig(ctx.config);
      ctx.db.deleteSource(key);
      // Removing a source can promote rows that were duplicates of its files.
      rebuildPrimaries(ctx.db, { mergeRawJpegPairs: ctx.config.mergeRawJpegPairs });
      json(res, 200, appState(ctx));
      return true;
    }

    if (sourceMatch && req.method === "PATCH") {
      const key = decodeURIComponent(sourceMatch[1] as string);
      const source = requireSource(ctx, key);
      const body = await readJson(req);

      if (typeof body.label === "string" && body.label.trim() !== "") source.label = body.label.trim();
      if (typeof body.enabled === "boolean") source.enabled = body.enabled;
      if (Array.isArray(body.excludes)) {
        source.excludes = body.excludes.filter((e): e is string => typeof e === "string");
      }

      await ctx.saveConfig(ctx.config);
      json(res, 200, appState(ctx));
      return true;
    }

    if (route === "POST /api/anchors") {
      const body = await readJson(req);
      const label = typeof body.label === "string" ? body.label.trim() : "";
      const day = typeof body.day === "string" ? parseIsoDay(body.day) : null;

      if (label === "") throw new HttpError(400, "An anchor needs a name.");
      if (day === null) throw new HttpError(400, "An anchor needs a date.");

      const taken = ctx.config.anchors.map((a) => a.id);
      ctx.config.anchors = [...ctx.config.anchors, makeAnchor(label, day, taken)].sort(
        (a, b) => a.day - b.day,
      );
      await ctx.saveConfig(ctx.config);
      json(res, 200, appState(ctx));
      return true;
    }

    const anchorMatch = url.pathname.match(/^\/api\/anchors\/([^/]+)$/);
    if (anchorMatch && req.method === "DELETE") {
      const id = decodeURIComponent(anchorMatch[1] as string);
      ctx.config.anchors = ctx.config.anchors.filter((a) => a.id !== id);
      await ctx.saveConfig(ctx.config);
      json(res, 200, appState(ctx));
      return true;
    }

    // Hiding a camera changes every count on every slide, so it is a setting
    // rather than a view state — it is saved, and it survives a restart.
    if (route === "POST /api/exclude") {
      const body = await readJson(req);
      const dimension = body.dimension === "camera" ? "cameras" : body.dimension === "lens" ? "lenses" : null;
      const key = typeof body.key === "string" ? body.key : "";

      if (dimension === null || key === "") throw new HttpError(400, "Which piece of gear?");

      const current = new Set(ctx.config.excluded[dimension]);
      if (body.excluded === false) current.delete(key);
      else current.add(key);

      ctx.config.excluded = { ...ctx.config.excluded, [dimension]: [...current] };
      await ctx.saveConfig(ctx.config);
      json(res, 200, appState(ctx));
      return true;
    }

    const cancelMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
    if (cancelMatch && req.method === "POST") {
      const cancelled = ctx.jobs.cancel(decodeURIComponent(cancelMatch[1] as string));
      json(res, cancelled ? 200 : 404, { cancelled });
      return true;
    }

    if (route === "GET /api/jobs") {
      json(res, 200, { jobs: ctx.jobs.list(), active: ctx.jobs.active });
      return true;
    }

    json(res, 404, { error: `No such endpoint: ${url.pathname}` });
    return true;
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    json(res, status, { error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}
