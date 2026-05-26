#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Phase 2 (per-schema): migrate `.file.card` files from Phase 1
 * frontmatter-with-XML-body to flat frontmatter.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/file.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/file.ts <boxRoot> --apply
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseCard, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";

const SPEC: ElementSpec = {
  attrs: ["status", "version"],
  children: {
    filename: { attrs: ["ref", "captured", "source", "original-name", "mime-type", "size"] },
    description: { attrs: [] },
  },
};

const warnings = new WarningCollector();

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
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".file.card")) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
  return node.children.find((c) => c.tagName === tagName);
}

function convertOne(node: ElementNode, source: string): Record<string, unknown> {
  if (node.tagName !== "file") {
    throw new Error(`${source}: expected <file> root, got <${node.tagName}>`);
  }
  const fields: Record<string, unknown> = {
    type: "file",
    status: node.attrs["status"] ?? "new",
  };
  const filenameEl = firstChild(node, "filename");
  if (filenameEl === undefined) {
    throw new Error(`${source}: missing <filename>`);
  }
  const ref = filenameEl.attrs["ref"];
  const captured = filenameEl.attrs["captured"];
  const fSource = filenameEl.attrs["source"];
  if (ref === undefined || captured === undefined || fSource === undefined) {
    throw new Error(`${source}: <filename> missing ref/captured/source`);
  }
  const filename: Record<string, unknown> = {
    ref,
    captured,
    source: fSource,
  };
  if (filenameEl.attrs["original-name"] !== undefined) {
    filename["original-name"] = filenameEl.attrs["original-name"];
  }
  if (filenameEl.attrs["mime-type"] !== undefined) {
    filename["mime-type"] = filenameEl.attrs["mime-type"];
  }
  if (filenameEl.attrs["size"] !== undefined) {
    const n = Number(filenameEl.attrs["size"]);
    if (Number.isFinite(n)) filename["size"] = n;
  }
  fields["filename"] = filename;
  const descEl = firstChild(node, "description");
  if (descEl !== undefined && descEl.text !== undefined && descEl.text !== "") {
    fields["description"] = descEl.text;
  }
  return fields;
}

async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
  const raw = await readFile(absPath, "utf8");
  if (/^---\r?\n[\s\S]*?\btype:\s*file\b/m.test(raw)) {
    return "already-migrated";
  }
  const node = await parseCard(raw, { source: absPath });
  checkElement({ node, source: absPath, spec: SPEC, warnings });
  const fields = convertOne(node, absPath);
  const yamlText = stringifyYaml(fields);
  await writeFile(absPath, `---\n${yamlText}---\n`);
  return "converted";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.filter((a) => !a.startsWith("--"));
  const boxRoot = positional[0];
  if (boxRoot === undefined) {
    console.error("Usage: migrate-file <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  const cards = await findCards(absRoot);
  console.log(`Found ${String(cards.length)} *.file.card files under ${absRoot}`);
  if (!apply) {
    console.log("Dry run. Pass --apply to convert.");
    return;
  }
  let converted = 0;
  let already = 0;
  const failed: Array<{ file: string; error: string }> = [];
  for (const f of cards) {
    try {
      const r = await migrateFile(f);
      if (r === "converted") converted++;
      else already++;
    } catch (e) {
      failed.push({ file: f, error: (e as Error).message });
    }
  }
  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
  for (const f of failed) {
    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
  }
  warnings.dump(absRoot);
  if (failed.length > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
