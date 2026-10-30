#!/usr/bin/env tsx
/**
 * Shared tombstone for every retired migration.
 *
 * The manifest (`_config/migrations.jsonl`) is append-only and keyed by name,
 * so a retired migration keeps its `MIGRATIONS` entry and points here. As of
 * 2026-10-08 every fleet box has applied every migration registered then; the
 * migrators that did the work are in git history.
 *
 * Invoked as `<boxRoot> --apply` like any migrator, with the entry's name in
 * `BBX_MIGRATION_NAME`. It only runs on a box that never applied the entry, so
 * it exits 1 and writes nothing: recording the entry as applied would hide the
 * gap for good. The sweep asks a human instead of starting an agent repair.
 */

const name = process.env["BBX_MIGRATION_NAME"] ?? "this migration";
console.error(
  `Migration ${name} was retired on 2026-10-08 because every fleet box had applied it, and this box never did. ` +
  "Restore its migrator from git history (retirement commit 81c647230; see \"Retired migrations\" in beebox/docs/cards/migrations.md), " +
  `run it by hand, then record ${name} in the manifest.`,
);
process.exitCode = 1;
