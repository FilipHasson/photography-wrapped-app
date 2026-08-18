import path from "node:path";
import os from "node:os";

/**
 * Windows and macOS both default to case-insensitive filesystems. We keep the
 * original casing for display but compare on a folded key, otherwise the same
 * file indexed from two differently-cased roots looks like two files.
 */
export const CASE_INSENSITIVE_FS =
  process.platform === "win32" || process.platform === "darwin";

/** Absolute path with forward slashes, so stored paths compare consistently. */
export function normPath(p: string): string {
  return path.resolve(p).split(path.sep).join("/");
}

/** Comparison key for a path. Never show this to the user. */
export function pathKey(p: string): string {
  const n = normPath(p);
  return CASE_INSENSITIVE_FS ? n.toLowerCase() : n;
}

/** Lowercased extension without the leading dot. `""` when there is none. */
export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** Basename without extension, lowercased — used for filename-tier matching. */
export function stemOf(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot <= 0 ? name : name.slice(0, dot);
  return base.toLowerCase();
}

export function configDir(): string {
  const override = process.env.WHAT_DID_I_SHOOT_HOME;
  if (override) return path.resolve(override);

  const home = os.homedir();
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "what-did-i-shoot");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "what-did-i-shoot");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "what-did-i-shoot");
}

export function configFile(): string {
  return path.join(configDir(), "config.json");
}

export function dbFile(): string {
  return path.join(configDir(), "index.db");
}

/** Scratch space for Lightroom catalog copies. */
export function cacheDir(): string {
  return path.join(configDir(), "cache");
}
