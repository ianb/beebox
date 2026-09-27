#!/usr/bin/env tsx

/**
 * Delete deprecated, schema-less card types: `news-item`, `news-brief`, and
 * `workflow`.
 *
 * None of these has a registered schema or any code that reads it: `workflow`
 * is the pre-procedures engine, fully superseded by `procedure`; `news-item` /
 * `news-brief` are a removed feature. They are XML-bodied dead data that
 * `bbx validate` can neither validate nor migrate, so they would block the
 * "no XML remains" end state for the cardworks removal. Git history is the
 * archive — this hard-deletes them.
 *
 * Empty parent directories (e.g. `config/workflows/`, `box/inbox/news/`) are
 * left behind; git doesn't track empty dirs, so they vanish on commit.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/delete-deprecated-cards.ts <root>           # dry-run
 *   pnpm exec tsx scripts/migrate/delete-deprecated-cards.ts <root> --apply
 */

import { unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { runMigration } from "./_harness.js";

const DEPRECATED_SUFFIXES = [".news-item.card", ".news-brief.card", ".workflow.card"];

/**
 * True for the deprecated, schema-less card types this migration deletes — the
 * load-bearing selection logic. Exported for tests.
 */
export function isDeprecatedCard(name: string): boolean {
  return DEPRECATED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

// CLI entry — only when run directly, not when imported by a test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMigration({
    description: "Delete deprecated schema-less cards: news-item, news-brief, workflow.",
    match: isDeprecatedCard,
    convert: async (absPath) => {
      await unlink(absPath);
      return "converted";
    },
  });
}
