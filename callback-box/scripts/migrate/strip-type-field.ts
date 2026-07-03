#!/usr/bin/env tsx

/**
 * One-shot migrator: remove the redundant `type:` field from every card's
 * YAML frontmatter. The filename (`Foo.<type>.card`) is the canonical type
 * discriminator; carrying a `type:` field in the YAML was a Phase-2 drift
 * that's now corrected at the loader layer (see src/core/card-io.ts).
 *
 * Strict: only strips lines where the YAML type matches the filename type.
 * A mismatch is left in place and reported — the user must reconcile by
 * either renaming the file or fixing the frontmatter before re-running.
 *
 * Idempotent. Safe on cards that already have no type field.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/strip-type-field.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/strip-type-field.ts <boxRoot> --apply
 */

import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

const TYPE_LINE_RE = /^type:\s*([\w-]+)\s*$/m;
const FRONTMATTER_RE = /^---\r?\n([\S\s]*?)\r?\n---/;

async function findCards(root: string): Promise<string[]> {
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
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".card")) out.push(full);
    }
  }
  await walk(root);
  return out;
}

function typeFromFilename(filePath: string): string | undefined {
  const base = basename(filePath);
  const match = base.match(/^.+\.([^.]+)\.card$/);
  return match ? match[1] : undefined;
}

type Outcome =
  | "stripped"
  | "stripped-and-renamed"
  | "no-frontmatter"
  | "no-type-field"
  | "no-filename-type"
  | "mismatch"
  | "xml-card";

/**
 * Build the rename target for a card whose YAML type doesn't match the
 * last filename segment, but matches the hyphen-joined version. Covers
 * the historical job naming: `foo.intake.job.card` with `type: intake-job`
 * gets renamed to `foo.intake-job.card`.
 */
function renameTargetForJoined(absPath: string, yamlType: string): string | undefined {
  const base = basename(absPath);
  const match = base.match(/^(.+?)\.([^/]+)\.card$/);
  if (!match) return undefined;
  const stem = match[1];
  const tail = match[2]; // everything between stem and .card
  if (tail === undefined || stem === undefined) return undefined;
  const joined = tail.replace(/\./g, "-");
  if (joined !== yamlType) return undefined;
  return join(dirname(absPath), `${stem}.${yamlType}.card`);
}

async function processFile(absPath: string): Promise<{ outcome: Outcome; detail?: string; newPath?: string }> {
  const raw = await readFile(absPath, "utf8");
  const fmMatch = raw.match(FRONTMATTER_RE);
  if (!fmMatch) return { outcome: "no-frontmatter" };
  const fmText = fmMatch[1] ?? "";

  // Skip cards whose frontmatter is the legacy Phase-1 wrapper around XML.
  if (/^content-type:\s*application\/x-card\+xml\s*$/m.test(fmText)) {
    return { outcome: "xml-card" };
  }

  const typeMatch = fmText.match(TYPE_LINE_RE);
  if (!typeMatch) return { outcome: "no-type-field" };

  const yamlType = typeMatch[1];
  if (yamlType === undefined) return { outcome: "no-type-field" };
  const fileType = typeFromFilename(absPath);
  if (fileType === undefined) {
    return { outcome: "no-filename-type" };
  }

  // Strip the type line in-memory first; we reuse it for both the
  // plain-rewrite and the rename-and-rewrite branches. If the type was
  // the only frontmatter field, leave a blank line so the splitter still
  // recognizes the block as having frontmatter (otherwise we'd produce
  // `---\n---\n` which fails parsing).
  let fmAfter = fmText.replace(/^type:\s*[\w-]+\s*\n?/m, "");
  if (fmAfter === fmText) return { outcome: "no-type-field" };
  if (fmAfter === "") fmAfter = "\n";
  const newRaw = raw.replace(fmText, fmAfter);

  if (yamlType === fileType) {
    await writeFile(absPath, newRaw);
    return { outcome: "stripped" };
  }

  // Filename type disagrees with YAML type. If the YAML type matches the
  // dot-segments-as-hyphens form (foo.intake.job → intake-job), rename
  // the file so filename becomes canonical.
  const target = renameTargetForJoined(absPath, yamlType);
  if (target !== undefined) {
    await writeFile(absPath, newRaw);
    await rename(absPath, target);
    return { outcome: "stripped-and-renamed", newPath: target };
  }

  return { outcome: "mismatch", detail: `yaml=${yamlType} file=${fileType}` };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.find((a) => !a.startsWith("--"));
  const boxRoot = positional;
  if (boxRoot === undefined) {
    console.error("Usage: strip-type-field <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  const cards = await findCards(absRoot);
  console.log(`Found ${String(cards.length)} *.card files under ${absRoot}`);
  if (!apply) {
    console.log("Dry run. Pass --apply to strip.");
    return;
  }

  const counts: Record<Outcome, number> = {
    stripped: 0,
    "stripped-and-renamed": 0,
    "no-frontmatter": 0,
    "no-type-field": 0,
    "no-filename-type": 0,
    mismatch: 0,
    "xml-card": 0,
  };
  const mismatches: Array<{ file: string; detail: string }> = [];
  const renames: Array<{ from: string; to: string }> = [];
  const failed: Array<{ file: string; error: string }> = [];

  for (const f of cards) {
    try {
      const r = await processFile(f);
      counts[r.outcome]++;
      if (r.outcome === "mismatch") {
        mismatches.push({ file: f, detail: r.detail ?? "" });
      }
      if (r.outcome === "stripped-and-renamed" && r.newPath !== undefined) {
        renames.push({ from: f, to: r.newPath });
      }
    } catch (e) {
      failed.push({ file: f, error: (e as Error).message });
    }
  }

  console.log("");
  for (const [k, v] of Object.entries(counts)) {
    if (v > 0) console.log(`  ${k}: ${String(v)}`);
  }
  if (renames.length > 0 && renames.length <= 20) {
    console.log("\nRenames:");
    for (const r of renames) {
      console.log(`  ${relative(absRoot, r.from)} → ${relative(absRoot, r.to)}`);
    }
  } else if (renames.length > 0) {
    console.log(`\nRenamed ${String(renames.length)} files (omitted full list).`);
  }
  if (mismatches.length > 0) {
    console.log(`\n${String(mismatches.length)} mismatch(es) — type left in place:`);
    for (const m of mismatches) {
      console.log(`  ${relative(absRoot, m.file)}: ${m.detail}`);
    }
  }
  if (failed.length > 0) {
    console.log(`\n${String(failed.length)} error(s):`);
    for (const f of failed) console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
