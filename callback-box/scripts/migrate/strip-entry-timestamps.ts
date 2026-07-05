#!/usr/bin/env tsx
/**
 * Strip file-metadata timestamps (`created-at`, `updated-at`, `added-at`) from
 * guide and personality cards.
 *
 * These were entry-level timestamps on guide/personality experiments and
 * context-notes — redundant with git history (git IS the record of when
 * something was written) and, worse, a churn source: guide templates stamped a
 * fresh `created-at` on every regeneration, so an otherwise-unmodified guide
 * differed from its template every run and perpetually parked as an "update
 * available". The fields are gone from the schemas and generation; this migrator
 * removes them from cards already on disk so those cards stop diverging.
 *
 * Recursively deletes the three keys anywhere in the card's frontmatter (they
 * live nested under `experiments[]` and `context-notes[]`). Body is untouched.
 *
 * Idempotent: a card with none of the keys is left as-is ("already"). A box
 * with no guide/personality cards is a no-op.
 *
 * Registered in src/core/migrations.ts. Also runnable directly:
 *   pnpm exec tsx scripts/migrate/strip-entry-timestamps.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/strip-entry-timestamps.ts <boxRoot> --apply
 */

import { readFile, writeFile } from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { runMigration } from "./_harness.js";

const TIMESTAMP_KEYS = ["created-at", "updated-at", "added-at"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Split a card's frontmatter text from its body. Returns null if no frontmatter. */
function splitCard(raw: string): { fm: string; body: string } | null {
  const m = raw.match(/^---\r?\n([\S\s]*?)\r?\n---\r?\n?([\S\s]*)$/);
  if (m === null) return null;
  return { fm: m[1] === undefined ? "" : m[1], body: m[2] === undefined ? "" : m[2] };
}

/** Delete the timestamp keys anywhere in the tree. Returns true if any removed. */
function stripTimestamps(node: unknown): boolean {
  let changed = false;
  if (Array.isArray(node)) {
    for (const item of node) if (stripTimestamps(item)) changed = true;
  } else if (isRecord(node)) {
    for (const key of TIMESTAMP_KEYS) {
      if (key in node) {
        delete node[key];
        changed = true;
      }
    }
    for (const value of Object.values(node)) if (stripTimestamps(value)) changed = true;
  }
  return changed;
}

// CLI entry — only when run directly (e.g. spawned by `cb migrate`), not when
// imported by a test.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await runMigration({
    description: "*.guide.card / *.personality.card: strip created-at/updated-at/added-at timestamps.",
    match: (name) => name.endsWith(".guide.card") || name.endsWith(".personality.card"),
    convert: async (file, { apply }) => {
      const split = splitCard(await readFile(file, "utf8"));
      if (split === null) return "already";
      let parsed: unknown;
      try {
        parsed = parseYaml(split.fm);
      } catch (_e) {
        return "already";
      }
      if (!isRecord(parsed)) return "already";
      if (!stripTimestamps(parsed)) return "already"; // idempotent
      if (apply) await writeFile(file, `---\n${stringifyYaml(parsed)}---\n${split.body}`);
      return "converted";
    },
  });
}

export { stripTimestamps, splitCard };
