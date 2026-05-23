#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Phase 2: migrate `.chat-thread.card` files from XML to YAML frontmatter.
 *
 * Usage:
 *   npx tsx scripts/migrate-chat-thread.ts <boxRoot>           # dry-run
 *   npx tsx scripts/migrate-chat-thread.ts <boxRoot> --apply
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseCard, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";

const KNOWN_ATTRS = new Set(["chat-id", "connector"]);
const KNOWN_CHILDREN = new Set(["description", "participants", "message", "seen"]);
const KNOWN_PARTICIPANTS_CHILDREN = new Set(["person"]);
const KNOWN_MESSAGE_ATTRS = new Set(["id", "sender", "sender-id", "time", "sent"]);
const KNOWN_SEEN_ATTRS = new Set(["callback-in", "wait-for"]);

interface Warning { file: string; message: string }
const warnings: Warning[] = [];

function checkUnknown(node: ElementNode, source: string): void {
  for (const attr of Object.keys(node.attrs)) {
    if (!KNOWN_ATTRS.has(attr)) {
      warnings.push({ file: source, message: `unknown attr on <chat-thread>: ${attr}="${String(node.attrs[attr])}"` });
    }
  }
  for (const child of node.children) {
    if (!KNOWN_CHILDREN.has(child.tagName)) {
      warnings.push({ file: source, message: `unknown child element: <${child.tagName}>` });
      continue;
    }
    if (child.tagName === "participants") {
      for (const sub of child.children) {
        if (!KNOWN_PARTICIPANTS_CHILDREN.has(sub.tagName)) {
          warnings.push({ file: source, message: `unknown <participants> child: <${sub.tagName}>` });
        }
      }
    } else if (child.tagName === "message") {
      for (const a of Object.keys(child.attrs)) {
        if (!KNOWN_MESSAGE_ATTRS.has(a)) {
          warnings.push({ file: source, message: `unknown attr on <message>: ${a}` });
        }
      }
    } else if (child.tagName === "seen") {
      for (const a of Object.keys(child.attrs)) {
        if (!KNOWN_SEEN_ATTRS.has(a)) {
          warnings.push({ file: source, message: `unknown attr on <seen>: ${a}` });
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
      } else if (entry.isFile() && entry.name.endsWith(".chat-thread.card")) {
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
  if (node.tagName !== "chat-thread") {
    throw new Error(`${source}: expected <chat-thread>, got <${node.tagName}>`);
  }
  const fields: Record<string, unknown> = {
    type: "chat-thread",
    "chat-id": node.attrs["chat-id"] ?? "",
    connector: node.attrs["connector"] ?? "",
  };

  const description = childText(node, "description");
  if (description !== undefined) fields["description"] = description;

  const participantsEl = node.children.find((c) => c.tagName === "participants");
  if (participantsEl !== undefined) {
    const people = participantsEl.children
      .filter((c) => c.tagName === "person")
      .map((c) => ({ ref: c.attrs["ref"] ?? "" }))
      .filter((p) => p.ref !== "");
    if (people.length > 0) fields["participants"] = people;
  }

  const entries: Array<Record<string, unknown>> = [];
  for (const child of node.children) {
    if (child.tagName === "message") {
      const entry: Record<string, unknown> = { kind: "message" };
      if (child.attrs["id"] !== undefined) entry["id"] = child.attrs["id"];
      entry["sender"] = child.attrs["sender"] ?? "";
      if (child.attrs["sender-id"] !== undefined) entry["sender-id"] = child.attrs["sender-id"];
      if (child.attrs["time"] !== undefined) entry["time"] = child.attrs["time"];
      if (child.attrs["sent"] !== undefined) entry["sent"] = child.attrs["sent"];
      entry["text"] = child.text ?? "";
      entries.push(entry);
    } else if (child.tagName === "seen") {
      const entry: Record<string, unknown> = { kind: "seen" };
      if (child.attrs["callback-in"] !== undefined) entry["callback-in"] = child.attrs["callback-in"];
      if (child.attrs["wait-for"] !== undefined) entry["wait-for"] = child.attrs["wait-for"];
      if (child.text !== undefined && child.text !== "") entry["text"] = child.text;
      entries.push(entry);
    }
  }
  fields["entries"] = entries;

  return fields;
}

async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
  const raw = await readFile(absPath, "utf8");
  if (/^---\r?\n[\s\S]*?\btype:\s*chat-thread\b/m.test(raw)) {
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
    console.error("Usage: migrate-chat-thread <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  const cards = await findCards(absRoot);
  console.log(`Found ${String(cards.length)} *.chat-thread.card files under ${absRoot}`);
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
