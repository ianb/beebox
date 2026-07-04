/**
 * Schema load failure bookkeeping, split out of registry.ts to keep that
 * file under its line budget.
 *
 * A box-local schema file that fails to load keeps serving its last-good
 * schema (see `loadOneSchemaFile` in registry.ts) so a broken mid-edit save
 * never blanks a working card type — but that keep-last-good behavior made
 * the failure itself invisible (`console.warn` only). This module records the
 * current failure set per box so `cb status` and `/healthz` can surface it,
 * mirroring how `listParkedTemplateUpdates` surfaces parked template drift.
 */

export interface SchemaLoadFailure {
  /** File name within the schemas dir (e.g. `widget.ts`) — not an absolute path. */
  file: string;
  message: string;
  /** ISO timestamp of the failed rebuild attempt. */
  at: string;
}

/**
 * Per-box snapshot of schema load failures from the most recent rebuild.
 * Replaced wholesale on every rebuild (not accumulated) — a fixed file drops
 * off, a still-broken one keeps its (fresh) timestamp.
 */
const schemaLoadFailures = new Map<string, SchemaLoadFailure[]>();

/** Replace a box's recorded failure set (called once per rebuild). */
export function setSchemaLoadFailures(boxRoot: string, failures: SchemaLoadFailure[]): void {
  if (failures.length > 0) {
    schemaLoadFailures.set(boxRoot, failures);
  } else {
    schemaLoadFailures.delete(boxRoot);
  }
}

/**
 * List a box's current schema load failures (empty if none, or if
 * `loadBoxSchemas` hasn't run for this boxRoot in this process yet — `cb
 * status` calls `loadBoxSchemas` itself first so a fresh CLI invocation still
 * sees them).
 */
export function listSchemaLoadFailures(boxRoot: string): SchemaLoadFailure[] {
  return schemaLoadFailures.get(boxRoot) ?? [];
}
