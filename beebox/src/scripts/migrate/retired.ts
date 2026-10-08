#!/usr/bin/env tsx
/**
 * Shared tombstone for every retired migration.
 *
 * The manifest (`_config/migrations.jsonl`) is append-only and keyed by name,
 * so a retired migration keeps its `MIGRATIONS` entry and points here. As of
 * 2026-10-08 every box has applied every migration registered then; the
 * migrators that did the work are in git history.
 *
 * Invoked as `<boxRoot> --apply` like any migrator. Does nothing, prints
 * nothing, exits 0.
 */
