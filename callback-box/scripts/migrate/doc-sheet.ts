#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Phase 2 (per-schema): migrate `.doc.card` and `.sheet.card` files from
 * Phase 1 frontmatter-with-XML-body to flat frontmatter. Both schemas are
 * pure metadata — no body content.
 *
 * Usage:
 *   npx tsx scripts/migrate-doc-sheet.ts <boxRoot>           # dry-run
 *   npx tsx scripts/migrate-doc-sheet.ts <boxRoot> --apply
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseCard, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { WarningCollector, checkElement, type ElementSpec } from "./_migrate-warnings.js";

const DOC_SPEC: ElementSpec = {
  attrs: ["drive-id", "status", "version"],
  children: {
    title: { attrs: [] },
    modified: { attrs: [] },
    revision: { attrs: [] },
    link: { attrs: [] },
    owner: { attrs: [] },
    content: { attrs: ["ref"] },
    lossy: { attrs: [], children: { item: { attrs: ["type", "count"] } } },
  },
};

const SHEET_SPEC: ElementSpec = {
  attrs: ["drive-id", "status", "version"],
  children: {
    title: { attrs: [] },
    modified: { attrs: [] },
    link: { attrs: [] },
    owner: { attrs: [] },
    sheets: {
      attrs: [],
      children: { "sheet-tab": { attrs: ["ref", "title", "gid"] } },
    },
  },
};

const warnings = new WarningCollector();

async function findCards(root: string, suffix: string): Promise<string[]> {
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
      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
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

function childText(node: ElementNode, tagName: string): string | undefined {
  return firstChild(node, tagName)?.text;
}

function convertDoc(node: ElementNode, source: string): Record<string, unknown> {
  if (node.tagName !== "doc") {
    throw new Error(`${source}: expected <doc> root, got <${node.tagName}>`);
  }
  const fields: Record<string, unknown> = {
    type: "doc",
    "drive-id": node.attrs["drive-id"] ?? "",
  };
  if (node.attrs["status"] !== undefined) fields["status"] = node.attrs["status"];
  const title = childText(node, "title");
  if (title !== undefined) fields["title"] = title;
  const modified = childText(node, "modified");
  if (modified !== undefined) fields["modified"] = modified;
  const revision = childText(node, "revision");
  if (revision !== undefined) fields["revision"] = revision;
  const link = childText(node, "link");
  if (link !== undefined) fields["link"] = link;
  const owner = childText(node, "owner");
  if (owner !== undefined) fields["owner"] = owner;
  const contentEl = firstChild(node, "content");
  if (contentEl !== undefined && contentEl.attrs["ref"] !== undefined) {
    fields["content"] = { ref: contentEl.attrs["ref"] };
  }
  const lossyEl = firstChild(node, "lossy");
  if (lossyEl !== undefined && lossyEl.children.length > 0) {
    const items: Array<{ type: string; count: number }> = [];
    for (const item of lossyEl.children) {
      if (item.tagName !== "item") continue;
      const t = item.attrs["type"];
      const c = item.attrs["count"];
      if (t === undefined || c === undefined) continue;
      const n = Number(c);
      if (!Number.isFinite(n)) continue;
      items.push({ type: t, count: n });
    }
    if (items.length > 0) fields["lossy"] = items;
  }
  return fields;
}

function convertSheet(node: ElementNode, source: string): Record<string, unknown> {
  if (node.tagName !== "sheet") {
    throw new Error(`${source}: expected <sheet> root, got <${node.tagName}>`);
  }
  const fields: Record<string, unknown> = {
    type: "sheet",
    "drive-id": node.attrs["drive-id"] ?? "",
  };
  if (node.attrs["status"] !== undefined) fields["status"] = node.attrs["status"];
  const title = childText(node, "title");
  if (title !== undefined) fields["title"] = title;
  const modified = childText(node, "modified");
  if (modified !== undefined) fields["modified"] = modified;
  const link = childText(node, "link");
  if (link !== undefined) fields["link"] = link;
  const owner = childText(node, "owner");
  if (owner !== undefined) fields["owner"] = owner;
  const sheetsEl = firstChild(node, "sheets");
  if (sheetsEl !== undefined && sheetsEl.children.length > 0) {
    const tabs: Array<{ ref: string; title: string; gid: string }> = [];
    for (const tab of sheetsEl.children) {
      if (tab.tagName !== "sheet-tab") continue;
      const ref = tab.attrs["ref"];
      const tabTitle = tab.attrs["title"];
      const gid = tab.attrs["gid"];
      if (ref === undefined || tabTitle === undefined || gid === undefined) continue;
      tabs.push({ ref, title: tabTitle, gid });
    }
    fields["sheets"] = tabs;
  } else {
    fields["sheets"] = [];
  }
  return fields;
}

async function migrateFile(
  absPath: string,
  kind: "doc" | "sheet"
): Promise<"converted" | "already-migrated"> {
  const raw = await readFile(absPath, "utf8");
  const typeMarker = kind === "doc" ? "type:\\s*doc\\b" : "type:\\s*sheet\\b";
  const re = new RegExp(`^---\\r?\\n[\\s\\S]*?\\b${typeMarker}`, "m");
  if (re.test(raw)) {
    return "already-migrated";
  }
  const node = await parseCard(raw, { source: absPath });
  checkElement({ node, source: absPath, spec: kind === "doc" ? DOC_SPEC : SHEET_SPEC, warnings });
  const fields = kind === "doc" ? convertDoc(node, absPath) : convertSheet(node, absPath);
  const yamlText = stringifyYaml(fields);
  await writeFile(absPath, `---\n${yamlText}---\n`);
  return "converted";
}

async function migrateKind(input: {
  absRoot: string;
  kind: "doc" | "sheet";
  apply: boolean;
}): Promise<void> {
  const { absRoot, kind, apply } = input;
  const suffix = `.${kind}.card`;
  const cards = await findCards(absRoot, suffix);
  console.log(`Found ${String(cards.length)} *${suffix} files under ${absRoot}`);
  if (!apply) {
    console.log(`Dry run for ${kind}. Pass --apply to convert.`);
    return;
  }
  let converted = 0;
  let already = 0;
  const failed: Array<{ file: string; error: string }> = [];
  for (const f of cards) {
    try {
      const r = await migrateFile(f, kind);
      if (r === "converted") converted++;
      else already++;
    } catch (e) {
      failed.push({ file: f, error: (e as Error).message });
    }
  }
  console.log(`${kind}: converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
  for (const f of failed) {
    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
  }
  if (failed.length > 0) process.exit(2);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.filter((a) => !a.startsWith("--"));
  const boxRoot = positional[0];
  if (boxRoot === undefined) {
    console.error("Usage: migrate-doc-sheet <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  await migrateKind({ absRoot, kind: "doc", apply });
  await migrateKind({ absRoot, kind: "sheet", apply });
  warnings.dump(absRoot);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
