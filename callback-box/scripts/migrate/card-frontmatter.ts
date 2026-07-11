#!/usr/bin/env tsx

/**
 * Phase 1 of the markdown-card migration: ensure every `.card` file begins
 * with a YAML frontmatter block. Cards that already have a frontmatter block
 * are left alone. Cards without one get this prepended:
 *
 *   ---
 *   content-type: application/x-card+xml
 *   ---
 *
 * No body content is altered. The cardworks parser handles the new prefix
 * transparently via `parseCard()`, so this migration is a no-op for readers
 * — it just sets up the file shape for Phase 2 (per-schema frontmatter/body
 * splits) without exposing any cards yet.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/card-frontmatter.ts <boxRoot>             # dry-run
 *   pnpm exec tsx scripts/migrate/card-frontmatter.ts <boxRoot> --apply     # execute
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../../src/lib/error-guards.js";

const CONTENT_TYPE_HEADER = "---\ncontent-type: application/x-card+xml\n---\n";
const FRONTMATTER_OPEN = /^---\r?\n/;

interface MigrationPlan {
  toRewrite: string[];
  alreadyHasFrontmatter: string[];
}

async function findCardFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (errnoCode(e) === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".card")) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

async function planMigration(cardFiles: string[]): Promise<MigrationPlan> {
  const toRewrite: string[] = [];
  const alreadyHasFrontmatter: string[] = [];
  for (const file of cardFiles) {
    const content = await fs.readFile(file, "utf8");
    if (FRONTMATTER_OPEN.test(content)) {
      alreadyHasFrontmatter.push(file);
    } else {
      toRewrite.push(file);
    }
  }
  return { toRewrite, alreadyHasFrontmatter };
}

async function applyMigration(toRewrite: string[]): Promise<void> {
  for (const file of toRewrite) {
    const original = await fs.readFile(file, "utf8");
    await fs.writeFile(file, CONTENT_TYPE_HEADER + original);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.find((a) => !a.startsWith("--"));
  const boxRoot = positional;
  if (boxRoot === undefined) {
    console.error("Usage: migrate-card-frontmatter <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = path.resolve(boxRoot);
  const cardFiles = await findCardFiles(absRoot);
  const plan = await planMigration(cardFiles);

  console.log(`Found ${String(cardFiles.length)} .card files under ${absRoot}`);
  console.log(`  ${String(plan.alreadyHasFrontmatter.length)} already have frontmatter`);
  console.log(`  ${String(plan.toRewrite.length)} need frontmatter prepended`);

  if (!apply) {
    if (plan.toRewrite.length > 0) {
      console.log("\nDry run. Files that would be rewritten:");
      for (const f of plan.toRewrite.slice(0, 20)) {
        console.log("  " + path.relative(absRoot, f));
      }
      if (plan.toRewrite.length > 20) {
        console.log(`  ... and ${String(plan.toRewrite.length - 20)} more`);
      }
    }
    console.log("\nRun with --apply to write changes.");
    return;
  }

  await applyMigration(plan.toRewrite);
  console.log(`Rewrote ${String(plan.toRewrite.length)} files.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
