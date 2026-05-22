#!/usr/bin/env tsx
/**
 * Phase 2 (per-schema): migrate `*.email-thread.card` files from the Phase 1
 * frontmatter-with-XML-body shape to the flat frontmatter shape.
 *
 * Before:
 *   ---
 *   content-type: application/x-card+xml
 *   ---
 *   <email-thread thread-id="abc" status="new" version="1.0.0">
 *     <subject>...</subject>
 *     <participants><participant>a@x</participant></participants>
 *     <date-range start="..." end="..."/>
 *     <labels><label>inbox</label></labels>
 *     <messages><message-ref ref="attach/msg-001.email-message.card"/></messages>
 *   </email-thread>
 *
 * After:
 *   ---
 *   type: email-thread
 *   thread-id: abc
 *   status: new
 *   subject: ...
 *   participants:
 *     - a@x
 *   date-range:
 *     start: ...
 *     end: ...
 *   labels:
 *     - inbox
 *   messages:
 *     - attach/msg-001.email-message.card
 *   ---
 *
 * Usage:
 *   npx tsx scripts/migrate-email-thread.ts <boxRoot>           # dry-run
 *   npx tsx scripts/migrate-email-thread.ts <boxRoot> --apply
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseCard, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";

interface ThreadFields {
  type: "email-thread";
  "thread-id": string;
  status?: string;
  subject: string;
  participants: string[];
  "date-range": { start: string; end: string };
  labels?: string[];
  messages: string[];
}

async function findThreadCards(root: string): Promise<string[]> {
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
      } else if (entry.isFile() && entry.name.endsWith(".email-thread.card")) {
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
  const child = firstChild(node, tagName);
  return child === undefined ? undefined : child.text;
}

function childList(
  parent: ElementNode,
  spec: {
    containerTag: string;
    itemTag: string;
    pluck: (item: ElementNode) => string | undefined;
  }
): string[] {
  const container = firstChild(parent, spec.containerTag);
  if (container === undefined) return [];
  const out: string[] = [];
  for (const item of container.children) {
    if (item.tagName !== spec.itemTag) continue;
    const value = spec.pluck(item);
    if (value !== undefined) out.push(value);
  }
  return out;
}

function convertOne(node: ElementNode, source: string): ThreadFields {
  if (node.tagName !== "email-thread") {
    throw new Error(`${source}: expected <email-thread> root, got <${node.tagName}>`);
  }
  const threadId = node.attrs["thread-id"];
  if (threadId === undefined) throw new Error(`${source}: missing thread-id`);

  const subject = childText(node, "subject");
  if (subject === undefined) throw new Error(`${source}: missing <subject>`);

  const participants = childList(node, {
    containerTag: "participants",
    itemTag: "participant",
    pluck: (p) => p.text,
  });

  const dateRange = firstChild(node, "date-range");
  if (dateRange === undefined) throw new Error(`${source}: missing <date-range>`);
  const start = dateRange.attrs["start"];
  const end = dateRange.attrs["end"];
  if (start === undefined || end === undefined) {
    throw new Error(`${source}: <date-range> missing start/end`);
  }

  const labels = childList(node, {
    containerTag: "labels",
    itemTag: "label",
    pluck: (l) => l.text,
  });
  const messages = childList(node, {
    containerTag: "messages",
    itemTag: "message-ref",
    pluck: (m) => m.attrs["ref"],
  });

  const fields: ThreadFields = {
    type: "email-thread",
    "thread-id": threadId,
    subject,
    participants,
    "date-range": { start, end },
    messages,
  };
  if (node.attrs["status"] !== undefined) {
    fields.status = node.attrs["status"];
  }
  if (labels.length > 0) {
    fields.labels = labels;
  }
  return fields;
}

async function migrateFile(absPath: string): Promise<"converted" | "already-migrated" | "skipped"> {
  const raw = await readFile(absPath, "utf8");
  // Already migrated? Look for `type: email-thread` near the top.
  if (/^---\r?\n[\s\S]*?\btype:\s*email-thread\b/m.test(raw)) {
    return "already-migrated";
  }
  const node = await parseCard(raw, { source: absPath });
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
    console.error("Usage: migrate-email-thread <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  const cards = await findThreadCards(absRoot);
  console.log(`Found ${String(cards.length)} *.email-thread.card files under ${absRoot}`);

  if (!apply) {
    console.log("Dry run. Pass --apply to convert.");
    if (cards.length > 0) {
      console.log("\nFirst few files:");
      for (const f of cards.slice(0, 10)) {
        console.log("  " + relative(absRoot, f));
      }
      if (cards.length > 10) {
        console.log(`  ... and ${String(cards.length - 10)} more`);
      }
    }
    return;
  }

  let converted = 0;
  let alreadyMigrated = 0;
  const failed: Array<{ file: string; error: string }> = [];
  for (const f of cards) {
    try {
      const result = await migrateFile(f);
      if (result === "converted") converted++;
      else if (result === "already-migrated") alreadyMigrated++;
    } catch (e) {
      failed.push({ file: f, error: (e as Error).message });
    }
  }
  console.log(`Converted ${String(converted)}, already migrated ${String(alreadyMigrated)}, failed ${String(failed.length)}.`);
  for (const f of failed) {
    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
  }
  if (failed.length > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
