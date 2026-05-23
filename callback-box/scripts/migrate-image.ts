#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Phase 2 (per-schema): migrate `.image.card` files from Phase 1
 * frontmatter-with-XML-body to flat frontmatter.
 *
 * Usage:
 *   npx tsx scripts/migrate-image.ts <boxRoot>           # dry-run
 *   npx tsx scripts/migrate-image.ts <boxRoot> --apply
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseCard, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { WarningCollector, checkElement, type ElementSpec } from "./_migrate-warnings.js";

const SPEC: ElementSpec = {
  attrs: ["status", "has-text", "rotation"],
  children: {
    filename: { attrs: ["ref", "captured", "source"] },
    description: { attrs: [] },
    creation: { attrs: [] },
    text: { attrs: ["source"] },
    exif: { attrs: ["date", "camera", "gps", "width", "height"] },
    "subject-bbox": { attrs: ["y1", "x1", "y2", "x2"] },
    document: {
      attrs: ["kind", "from"],
      children: { date: { attrs: ["label"] } },
    },
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
      } else if (entry.isFile() && entry.name.endsWith(".image.card")) {
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
  if (node.tagName !== "image") {
    throw new Error(`${source}: expected <image> root, got <${node.tagName}>`);
  }
  const fields: Record<string, unknown> = {
    type: "image",
    status: node.attrs["status"] ?? "new",
  };
  if (node.attrs["has-text"] !== undefined) {
    fields["has-text"] = node.attrs["has-text"] === "true";
  }
  if (node.attrs["rotation"] !== undefined) {
    fields["rotation"] = node.attrs["rotation"];
  }

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
  fields["filename"] = { ref, captured, source: fSource };

  const descEl = firstChild(node, "description");
  if (descEl !== undefined && descEl.text !== undefined && descEl.text !== "") {
    fields["description"] = descEl.text;
  }

  const creationEl = firstChild(node, "creation");
  if (creationEl !== undefined && creationEl.text !== undefined && creationEl.text !== "") {
    fields["creation"] = creationEl.text;
  }

  const textBlocks: Array<{ source?: string; content: string }> = [];
  for (const c of node.children) {
    if (c.tagName !== "text") continue;
    if (c.text === undefined || c.text === "") continue;
    const entry: { source?: string; content: string } = { content: c.text };
    if (c.attrs["source"] !== undefined) entry.source = c.attrs["source"];
    textBlocks.push(entry);
  }
  if (textBlocks.length > 0) fields["text"] = textBlocks;

  const exifEl = firstChild(node, "exif");
  if (exifEl !== undefined) {
    const exif: Record<string, string> = {};
    for (const k of ["date", "camera", "gps", "width", "height"]) {
      const v = exifEl.attrs[k];
      if (v !== undefined) exif[k] = v;
    }
    if (Object.keys(exif).length > 0) fields["exif"] = exif;
  }

  const bboxEl = firstChild(node, "subject-bbox");
  if (bboxEl !== undefined) {
    const y1 = bboxEl.attrs["y1"];
    const x1 = bboxEl.attrs["x1"];
    const y2 = bboxEl.attrs["y2"];
    const x2 = bboxEl.attrs["x2"];
    if (y1 !== undefined && x1 !== undefined && y2 !== undefined && x2 !== undefined) {
      fields["subject-bbox"] = { y1, x1, y2, x2 };
    }
  }

  const docEl = firstChild(node, "document");
  if (docEl !== undefined) {
    const doc: Record<string, unknown> = {};
    if (docEl.attrs["kind"] !== undefined) doc["kind"] = docEl.attrs["kind"];
    if (docEl.attrs["from"] !== undefined) doc["from"] = docEl.attrs["from"];
    const dates: Array<{ label: string; value: string }> = [];
    for (const d of docEl.children) {
      if (d.tagName !== "date") continue;
      const label = d.attrs["label"];
      const value = d.text;
      if (label !== undefined && value !== undefined) {
        dates.push({ label, value });
      }
    }
    if (dates.length > 0) doc["dates"] = dates;
    fields["document"] = doc;
  }

  return fields;
}

async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
  const raw = await readFile(absPath, "utf8");
  if (/^---\r?\n[\s\S]*?\btype:\s*image\b/m.test(raw)) {
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
    console.error("Usage: migrate-image <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  const cards = await findCards(absRoot);
  console.log(`Found ${String(cards.length)} *.image.card files under ${absRoot}`);
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
