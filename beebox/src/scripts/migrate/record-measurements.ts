#!/usr/bin/env tsx

/**
 * Rename the `record` card's `measures` field to `measurements`.
 *
 * The vocabulary sweep (docs/plans/vocab-glossary-sweep.md) split the record
 * schema's number-carrying fields: `quantity` (a single "how much do I have"
 * value, new and optional — nothing to migrate) and `measurements` (the old
 * `measures` list, renamed because "measures" barely exists as a noun for
 * physical facts). This migration rewrites `measures:` to `measurements:` on
 * existing `*.record.card` files so the data survives the schema rename (a
 * stale `measures` key would otherwise be stripped as unknown on load).
 *
 * Entry values pass through verbatim — the `{value, note?}` shape is
 * unchanged — so there is no data-loss path and no warnings spec (same
 * reasoning as person-aliases.ts). If `measurements` already exists alongside
 * `measures` (hand-edited mid-transition), the lists are concatenated,
 * existing entries first. Idempotent: a card with no `measures` key is left
 * untouched.
 *
 * Registered in src/core/migrations.ts, so `bbx migrate --apply` runs it
 * against any box that hasn't recorded it. Also runnable directly:
 *   pnpm exec tsx scripts/migrate/record-measurements.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/record-measurements.ts <boxRoot> --apply
 */

import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { runMigration } from "./_harness.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Split a card's frontmatter text from its body. Returns null if no frontmatter. */
function splitCard(raw: string): { fm: string; body: string } | null {
  const m = raw.match(/^---\r?\n([\S\s]*?)\r?\n---\r?\n?([\S\s]*)$/);
  if (m === null) return null;
  return { fm: m[1] === undefined ? "" : m[1], body: m[2] === undefined ? "" : m[2] };
}

/** Coerce a frontmatter value to an array: arrays pass through; a bare
 * value becomes a single-element array; absent/empty becomes `[]`. */
function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

/**
 * Rewrite one record card's text, or null if nothing changed. Returns null
 * for a card with no `measures` key (already migrated) and, like the other
 * migrators, for a malformed card (no frontmatter / unparseable YAML) — such
 * a card is independently broken and surfaced by `bbx validate`/load, not
 * this rename. Exported for tests.
 */
export function rewriteCardText(fileName: string, raw: string): string | null {
  if (!fileName.endsWith(".record.card")) return null;
  const split = splitCard(raw);
  if (split === null) return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(split.fm);
  } catch (_e) {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (!("measures" in parsed)) return null; // idempotent: nothing to rename

  // Rename `measures` → `measurements`, values verbatim. If `measurements`
  // already exists, concatenate rather than drop — existing entries first.
  const measureItems = toArray(parsed["measures"]);
  delete parsed["measures"];
  const existing = "measurements" in parsed ? toArray(parsed["measurements"]) : [];
  parsed["measurements"] = [...existing, ...measureItems];
  const yamlText = stringifyYaml(parsed);
  return `---\n${yamlText}---\n${split.body}`;
}

// CLI entry — only when run directly (e.g. spawned by `bbx migrate`), not when
// imported by a test.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await runMigration({
    description: "*.record.card: rename the `measures` field to `measurements`.",
    match: (name) => name.endsWith(".record.card"),
    convert: async (file, { apply }) => {
      const rewritten = rewriteCardText(basename(file), await readFile(file, "utf8"));
      if (rewritten === null) return "already";
      if (apply) await writeFile(file, rewritten);
      return "converted";
    },
  });
}
