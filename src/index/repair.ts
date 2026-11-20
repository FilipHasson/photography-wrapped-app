import type { Db } from "../core/db.ts";
import { normalizeLens, splitTeleconverter } from "../core/gear.ts";

/**
 * Bringing an existing index up to date with rules that changed after it was
 * built.
 *
 * Adding a column is `core/db.ts`'s job. This is the other half: rows already
 * written under an older rule, which no amount of schema will fix. The case
 * that forced it is teleconverters — an index built before they were understood
 * has `FE 200-600mm F5.6-6.3 G OSS + 1.4X Teleconverter` as a *separate lens*,
 * with its own key, sitting three rows below the lens it is.
 *
 * Re-indexing would also fix it, and for a catalog that takes seconds — but a
 * folder library of two hundred thousand files is an hour of reading headers,
 * and nobody should have to spend that on a rule they never saw change.
 *
 * Every pass here is idempotent: running it on an index that needs nothing does
 * one small query and stops.
 */

interface LensRow {
  id: number;
  key: string;
  label: string;
  make: string;
  model: string;
  raw_model: string | null;
}

export interface RepairResult {
  /** Lens rows folded back into the lens they were taken with. */
  teleconverters: number;
}

export function repairIndex(db: Db): RepairResult {
  return { teleconverters: splitStoredTeleconverters(db) };
}

/**
 * Folds `<lens> + 1.4X Teleconverter` rows back into `<lens>`, recording the
 * converter on the photographs instead.
 *
 * The frames move first and the empty lens row goes last, inside one
 * transaction, so an interrupted run cannot leave photographs pointing at a
 * lens that no longer exists.
 */
function splitStoredTeleconverters(db: Db): number {
  const candidates = db
    .allAs<LensRow>("SELECT id, key, label, make, model, raw_model FROM lens")
    .map((row) => ({ row, split: splitTeleconverter(row.raw_model ?? row.model) }))
    .filter((entry) => entry.split.teleconverter !== null);

  if (candidates.length === 0) return 0;

  return db.tx(() => {
    let merged = 0;

    for (const { row, split } of candidates) {
      const bare = normalizeLens(row.make, split.optics);
      if (!bare) continue;

      const existing = db.getAs<{ id: number }>("SELECT id FROM lens WHERE key = ?", bare.key);

      if (existing && existing.id !== row.id) {
        // The bare lens is already known: move the frames onto it.
        db.prep("UPDATE photo SET lens_id = ?, tc = ? WHERE lens_id = ?").run(
          existing.id,
          split.teleconverter,
          row.id,
        );
        db.prep("DELETE FROM lens WHERE id = ?").run(row.id);
      } else {
        // Only ever used with a converter, so this row becomes the bare lens.
        db.prep(
          "UPDATE lens SET key = ?, label = ?, make = ?, model = ?, raw_make = ?, raw_model = ? WHERE id = ?",
        ).run(bare.key, bare.label, bare.make, bare.model, bare.raw.make, bare.raw.model, row.id);
        db.prep("UPDATE photo SET tc = ? WHERE lens_id = ?").run(split.teleconverter, row.id);
      }

      merged++;
    }

    return merged;
  });
}
