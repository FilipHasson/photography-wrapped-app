import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Whether the running server is still the code on disk.
 *
 * Node reads this project's TypeScript once, when the process starts, and never
 * again. Edit a file while the server is up and the page keeps serving what was
 * loaded at boot — the deck looks unchanged, the change looks broken, and the
 * only clue is that nothing you do makes any difference. That has cost more
 * time on this project than any actual bug.
 *
 * So the newest modification time under `src/` is recorded at startup and
 * checked again whenever the page asks for state. If anything on disk is newer,
 * the page says so and asks for a restart. It is cheap — a few dozen `stat`
 * calls, and only once a second at most.
 */

const SOURCE_DIR = path.resolve(fileURLToPath(import.meta.url), "..", "..");

/** How long a scan is trusted before the tree is walked again. */
const CACHE_MS = 1000;

let bootMtime = 0;
let checkedAt = 0;
let cached = false;

async function newestMtime(dir: string): Promise<number> {
  let newest = 0;

  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, await newestMtime(full));
      continue;
    }
    if (!/\.(ts|js|css|html)$/.test(entry.name)) continue;
    const stat = await fs.stat(full).catch(() => null);
    if (stat) newest = Math.max(newest, stat.mtimeMs);
  }

  return newest;
}

/** Called once, before the first request is served. */
export async function recordBootState(): Promise<void> {
  bootMtime = await newestMtime(SOURCE_DIR);
  checkedAt = Date.now();
  cached = false;
}

/**
 * True when a source file has changed since this process started — meaning the
 * deck being served is built by code that no longer exists.
 */
export async function sourceHasChanged(): Promise<boolean> {
  if (bootMtime === 0) return false;
  if (Date.now() - checkedAt < CACHE_MS) return cached;

  checkedAt = Date.now();
  // A second of slack, so a filesystem with coarse timestamps does not report a
  // file written moments before boot as one written after it.
  cached = (await newestMtime(SOURCE_DIR)) > bootMtime + 1000;
  return cached;
}
