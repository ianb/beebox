#!/usr/bin/env tsx

/**
 * Rename the `person` card's `called` field to `aliases`.
 *
 * `aliases` is the standard "other names" field for named-entity cards
 * (person, place). `person` historically called it `called`; this migration
 * rewrites `called:` to `aliases:` on existing `*.person.card` files so the
 * data survives the schema rename (a stale `called` key would otherwise be
 * stripped as unknown on load).
 *
 * The key is renamed in place (same position), preserving its array value.
 * Idempotent: a card with no `called` key (already migrated, or never had one)
 * is left untouched.
 *
 * NOT touched (different concepts that share the word "called"): the
 * `{% key-person called="…" %}` briefing-tag attribute, and the personality
 * card's `boxholder.called` nickname.
 *
 * Registered in src/core/migrations.ts, so `bbx migrate --apply` runs it against
 * any box that hasn't recorded it. Also runnable directly:
 *   pnpm exec tsx scripts/migrate/person-aliases.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/person-aliases.ts <boxRoot> --apply
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

/** Coerce a frontmatter value to a string array: arrays pass through; a bare
 * scalar becomes a single-element array; absent/empty becomes `[]`. */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

/**
 * Rewrite one person card's text, or null if nothing changed. Returns null for
 * a card with no `called` key (already migrated) and, like the other migrators,
 * for a malformed card (no frontmatter / unparseable YAML) — such a card is
 * independently broken and surfaced by `bbx validate`/load, not this rename.
 * Exported for tests.
 */
export function rewriteCardText(fileName: string, raw: string): string | null {
  if (!fileName.endsWith(".person.card")) return null;
  const split = splitCard(raw);
  if (split === null) return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(split.fm);
  } catch (_e) {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (!("called" in parsed)) return null; // idempotent: nothing to rename

  // Rename `called` → `aliases`, normalizing to a string array (the schema
  // requires an array, so a scalar `called: Dad` must become `aliases: [Dad]`).
  // If `aliases` already exists, merge rather than drop `called` — dedupe,
  // existing aliases first.
  const calledItems = toStringArray(parsed["called"]);
  delete parsed["called"];
  const merged = "aliases" in parsed ? toStringArray(parsed["aliases"]) : [];
  for (const item of calledItems) {
    if (!merged.includes(item)) merged.push(item);
  }
  parsed["aliases"] = merged;
  const yamlText = stringifyYaml(parsed);
  return `---\n${yamlText}---\n${split.body}`;
}

// CLI entry — only when run directly (e.g. spawned by `bbx migrate`), not when
// imported by a test.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await runMigration({
    description: "*.person.card: rename the `called` field to `aliases`.",
    match: (name) => name.endsWith(".person.card"),
    convert: async (file, { apply }) => {
      const rewritten = rewriteCardText(basename(file), await readFile(file, "utf8"));
      if (rewritten === null) return "already";
      if (apply) await writeFile(file, rewritten);
      return "converted";
    },
  });
}
