#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Rename existing Google-Doc cards from `.doc.card` to `.gdoc.card` and
 * flip the frontmatter `type:` field from "doc" to "gdoc". The `doc`
 * type name is being reclaimed for a new generic document schema; the
 * Google-Doc-specific schema is now `gdoc`.
 *
 * Idempotent — skips cards already on `gdoc`.
 *
 * Usage:
 *   npx tsx scripts/migrate-doc-to-gdoc.ts <boxRoot>           # dry-run
 *   npx tsx scripts/migrate-doc-to-gdoc.ts <boxRoot> --apply
 */

import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

async function findDocCards(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".doc.card")) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

interface Outcome {
  status: "renamed" | "type-only" | "already-gdoc" | "skip-generic-doc";
  newPath?: string;
}

async function migrateFile(absPath: string): Promise<Outcome> {
  const raw = await readFile(absPath, "utf8");

  // Detect frontmatter type. Cards already declaring `type: gdoc` get
  // their filename brought in line; cards declaring `type: doc` for the
  // new generic schema (no drive-id, no content-ref) are left alone —
  // we distinguish by the presence of `drive-id:`.
  const typeMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = typeMatch ? typeMatch[1] ?? "" : "";
  const typeField = /^type:\s*([\w-]+)\s*$/m.exec(fm);
  const currentType = typeField?.[1];
  const hasDriveId = /^drive-id:/m.test(fm);

  if (currentType === "gdoc") {
    // Frontmatter is correct; just rename the file if needed.
    const newPath = absPath.replace(/\.doc\.card$/, ".gdoc.card");
    if (newPath !== absPath) {
      await rename(absPath, newPath);
      return { status: "renamed", newPath };
    }
    return { status: "already-gdoc" };
  }

  if (currentType !== "doc") {
    return { status: "skip-generic-doc" };
  }

  if (!hasDriveId) {
    // type: doc but no drive-id → this is the new generic doc shape that
    // happens to share the file extension. Skip; the user's new schema
    // takes precedence.
    return { status: "skip-generic-doc" };
  }

  // Rewrite the type line and rename the file.
  const rewritten = raw.replace(/^type:\s*doc\s*$/m, "type: gdoc");
  const newPath = absPath.replace(/\.doc\.card$/, ".gdoc.card");
  await writeFile(absPath, rewritten);
  await rename(absPath, newPath);
  return { status: "renamed", newPath };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.filter((a) => !a.startsWith("--"));
  const boxRoot = positional[0];
  if (boxRoot === undefined) {
    console.error("Usage: migrate-doc-to-gdoc <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  const cards = await findDocCards(absRoot);
  console.log(`Found ${String(cards.length)} *.doc.card files under ${absRoot}`);
  if (!apply) {
    console.log("Dry run. Pass --apply to convert.");
    return;
  }

  let renamed = 0;
  let alreadyGdoc = 0;
  let skipped = 0;
  const failed: Array<{ file: string; error: string }> = [];
  for (const f of cards) {
    try {
      const o = await migrateFile(f);
      if (o.status === "renamed") {
        renamed++;
        console.log(`  renamed ${relative(absRoot, f)} → ${relative(absRoot, o.newPath ?? f)}`);
      } else if (o.status === "already-gdoc") {
        alreadyGdoc++;
      } else if (o.status === "skip-generic-doc") {
        skipped++;
        console.log(`  skipped ${relative(absRoot, f)} (generic doc, not a Google Doc)`);
      }
    } catch (e) {
      failed.push({ file: f, error: (e as Error).message });
    }
  }
  console.log(
    `Renamed ${String(renamed)}, already gdoc ${String(alreadyGdoc)}, ` +
    `skipped (generic doc) ${String(skipped)}, failed ${String(failed.length)}.`,
  );
  for (const f of failed) {
    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
  }
  if (failed.length > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
