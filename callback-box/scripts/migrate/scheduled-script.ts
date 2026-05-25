#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Phase 2: migrate `.scheduled-script.card` files from
 * frontmatter-with-XML-body to flat YAML frontmatter.
 *
 * Usage:
 *   npx tsx scripts/migrate/scheduled-script.ts <boxRoot>           # dry-run
 *   npx tsx scripts/migrate/scheduled-script.ts <boxRoot> --apply
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseCard, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";

const KNOWN_ATTRS = new Set([
  "cron", "at", "rrule", "until", "not-before", "on-wakeup", "once",
  "enabled", "budget", "lock-group",
]);
const KNOWN_CHILDREN = new Set([
  "description", "runs", "source", "create-after-success", "requires",
]);
const KNOWN_REQUIRES_CHILDREN = new Set(["connector"]);

interface Warning { file: string; message: string }
const warnings: Warning[] = [];

function checkUnknown(node: ElementNode, source: string): void {
  for (const attr of Object.keys(node.attrs)) {
    if (!KNOWN_ATTRS.has(attr)) {
      warnings.push({ file: source, message: `unknown attr on <scheduled-script>: ${attr}="${String(node.attrs[attr])}"` });
    }
  }
  for (const child of node.children) {
    if (!KNOWN_CHILDREN.has(child.tagName)) {
      warnings.push({ file: source, message: `unknown child element: <${child.tagName}>` });
      continue;
    }
    if (child.tagName === "requires") {
      for (const sub of child.children) {
        if (!KNOWN_REQUIRES_CHILDREN.has(sub.tagName)) {
          warnings.push({ file: source, message: `unknown <requires> child: <${sub.tagName}>` });
        }
      }
    }
  }
}

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
      } else if (entry.isFile() && entry.name.endsWith(".scheduled-script.card")) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

function childText(node: ElementNode, tagName: string): string | undefined {
  const c = node.children.find((c) => c.tagName === tagName);
  if (c === undefined) return undefined;
  const t = c.text;
  return t === undefined || t === "" ? undefined : t;
}

function convertOne(node: ElementNode, source: string): Record<string, unknown> {
  if (node.tagName !== "scheduled-script") {
    throw new Error(`${source}: expected <scheduled-script>, got <${node.tagName}>`);
  }
  const fields: Record<string, unknown> = { type: "scheduled-script" };

  const a = node.attrs;
  if (a["cron"] !== undefined) fields["cron"] = a["cron"];
  if (a["at"] !== undefined) fields["at"] = a["at"];
  if (a["rrule"] !== undefined) fields["rrule"] = a["rrule"];
  if (a["until"] !== undefined) fields["until"] = a["until"];
  if (a["not-before"] !== undefined) fields["not-before"] = a["not-before"];
  if (a["on-wakeup"] === "true") fields["on-wakeup"] = true;
  if (a["once"] === "true") fields["once"] = true;
  if (a["enabled"] === "false") fields["enabled"] = false;
  if (a["budget"] !== undefined) fields["budget"] = a["budget"];
  if (a["lock-group"] !== undefined) fields["lock-group"] = a["lock-group"];

  const description = childText(node, "description");
  if (description !== undefined) fields["description"] = description;

  const runs = childText(node, "runs");
  fields["runs"] = runs ?? "";

  const sourceEl = node.children.find((c) => c.tagName === "source");
  if (sourceEl !== undefined) {
    const ref = sourceEl.attrs["ref"];
    const text = sourceEl.text;
    if (ref !== undefined) {
      const src: Record<string, string> = { ref };
      if (text !== undefined && text !== "") src["text"] = text;
      fields["source"] = src;
    } else if (text !== undefined && text !== "") {
      fields["source"] = text;
    }
  }

  const chains = node.children.filter((c) => c.tagName === "create-after-success");
  if (chains.length > 0) {
    fields["create-after-success"] = chains.map((el) => {
      const args: Record<string, string> = {};
      const text = el.text?.trim() ?? "";
      if (text !== "") {
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (trimmed === "") continue;
          const eq = trimmed.indexOf("=");
          if (eq > 0) args[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
        }
      }
      const entry: Record<string, unknown> = { path: el.attrs["path"] };
      if (Object.keys(args).length > 0) entry["args"] = args;
      return entry;
    });
  }

  const requires = node.children.find((c) => c.tagName === "requires");
  if (requires !== undefined) {
    const connectors = requires.children
      .filter((c) => c.tagName === "connector")
      .map((c) => c.attrs["name"] as string);
    if (connectors.length > 0) {
      fields["requires"] = { connectors };
    }
  }

  return fields;
}

async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
  const raw = await readFile(absPath, "utf8");
  if (/^---\r?\n[\s\S]*?\btype:\s*scheduled-script\b/m.test(raw)) {
    return "already-migrated";
  }
  const node = await parseCard(raw, { source: absPath });
  checkUnknown(node, absPath);
  const fields = convertOne(node, absPath);
  await writeFile(absPath, `---\n${stringifyYaml(fields)}---\n`);
  return "converted";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.filter((a) => !a.startsWith("--"));
  const boxRoot = positional[0];
  if (boxRoot === undefined) {
    console.error("Usage: migrate-scheduled-script <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  const cards = await findCards(absRoot);
  console.log(`Found ${String(cards.length)} *.scheduled-script.card files under ${absRoot}`);
  if (!apply) return;
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
  if (warnings.length > 0) {
    console.log(`\n${String(warnings.length)} warning(s) about unrecognized fields:`);
    for (const w of warnings) {
      console.log(`  ${relative(absRoot, w.file)}: ${w.message}`);
    }
  }
  if (failed.length > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
