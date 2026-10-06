#!/usr/bin/env tsx

/**
 * Move `src/publications/<name>/` publications onto their cards: the card at
 * `<dir>/<name>.publication.card` becomes the publication (request fields in
 * frontmatter) and its source moves to `<name>.attach/static/` or
 * `<name>.attach/project/`. Leftover pointer cards that cannot become valid
 * publications are deleted (empty) or kept as `.md` notes. Stock guidance
 * (`src/publications/CLAUDE.md`, `NOTES.md`) is deleted; edited copies are
 * parked or moved. Idempotent: a migrated box is a clean no-op.
 *
 * Usage:
 *   pnpm exec tsx src/scripts/migrate/publication-cards/run.ts <boxRoot>           # dry-run
 *   pnpm exec tsx src/scripts/migrate/publication-cards/run.ts <boxRoot> --apply
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { publicationCardsByPubId } from "../../../core/card-lint/publication-duplicates.js";
import { writeBoxGitignore } from "../../../core/box/structure/core.js";
import { abs, entryKind, readOrNull, type MigrationContext } from "./box-fs.js";
import { invalidPublicationCards, retireGuidance } from "./cleanup.js";
import { migratePublication } from "./publications.js";

export interface PublicationCardsReport {
  actions: string[];
  warnings: string[];
}

/** Migrate one box. With `apply: false` it reports what it would do without writing. */
export async function migratePublicationCards({ boxRoot, apply }: { boxRoot: string; apply: boolean }): Promise<PublicationCardsReport> {
  const ctx: MigrationContext = { boxRoot, apply, actions: [], warnings: [], handledCards: new Set(), migratedCards: [] };
  const rootKind = await entryKind(ctx, "src/publications");
  if (rootKind === "symlink") ctx.warnings.push("src/publications is a symlink; publications not migrated");
  if (rootKind === "dir") {
    const cards = await publicationCardsByPubId(boxRoot);
    const entries = await fs.readdir(abs(ctx, "src/publications"), { withFileTypes: true });
    for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) await migratePublication(ctx, { name: entry.name, cards });
    }
  }
  await invalidPublicationCards(ctx);
  await retireGuidance(ctx);
  if (apply) {
    const before = await readOrNull(ctx, ".gitignore");
    await writeBoxGitignore(boxRoot);
    const after = await readOrNull(ctx, ".gitignore");
    if (before !== after) ctx.actions.push("regenerate .gitignore");
  }
  return { actions: ctx.actions, warnings: ctx.warnings };
}

// CLI entry — only when run directly, not when imported by a doctest.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const boxRoot = args.find((a) => !a.startsWith("--"));
  if (boxRoot === undefined) {
    console.error("Usage: publication-cards <boxRoot> [--apply]");
    process.exit(1);
  }
  const report = await migratePublicationCards({ boxRoot: path.resolve(boxRoot), apply });
  const suffix = apply ? "" : " (dry run — pass --apply)";
  for (const line of report.actions) console.log(`${line}${suffix}`);
  for (const line of report.warnings) console.warn(`warning: ${line}`);
}
