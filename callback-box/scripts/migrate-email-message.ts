#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Phase 2 (per-schema): migrate `*.email-message.card` files from the Phase 1
 * frontmatter-with-XML-body shape to the flat frontmatter shape.
 *
 * Before:
 *   ---
 *   content-type: application/x-card+xml
 *   ---
 *   <email-message message-id="..." thread-id="...">
 *     <from>alice@example.com</from>
 *     <to>bob@example.com</to>
 *     <cc>...</cc>
 *     <date>2026-02-15T10:00:00Z</date>
 *     <subject>...</subject>
 *     <snippet>...</snippet>
 *     <body-file>attach/msg-001.body.txt</body-file>
 *     <attachments>
 *       <attachment ref="attach/file.pdf" content-type="application/pdf" size="123"/>
 *     </attachments>
 *   </email-message>
 *
 * After:
 *   ---
 *   type: email-message
 *   message-id: ...
 *   thread-id: ...
 *   from: alice@example.com
 *   to: bob@example.com
 *   date: 2026-02-15T10:00:00Z
 *   subject: ...
 *   body-file:
 *     ref: attach/msg-001.body.txt
 *   attachments:
 *     - ref: attach/file.pdf
 *       content-type: application/pdf
 *       size: 123
 *   ---
 *
 * Usage:
 *   npx tsx scripts/migrate-email-message.ts <boxRoot>           # dry-run
 *   npx tsx scripts/migrate-email-message.ts <boxRoot> --apply
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseCard, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { WarningCollector, checkElement, type ElementSpec } from "./_migrate-warnings.js";

const SPEC: ElementSpec = {
  attrs: ["message-id", "thread-id", "version"],
  children: {
    from: { attrs: [] },
    to: { attrs: [] },
    cc: { attrs: [] },
    date: { attrs: [] },
    subject: { attrs: [] },
    snippet: { attrs: [] },
    "body-file": { attrs: [] },
    attachments: {
      attrs: [],
      children: {
        attachment: { attrs: ["ref", "content-type", "size"] },
      },
    },
  },
};

const warnings = new WarningCollector();

interface AttachmentEntry {
  ref: string;
  "content-type": string;
  size?: number;
}

interface MessageFields {
  type: "email-message";
  "message-id": string;
  "thread-id": string;
  from: string;
  to?: string;
  cc?: string;
  date: string;
  subject: string;
  snippet?: string;
  "body-file": { ref: string };
  attachments?: AttachmentEntry[];
}

async function findMessageCards(root: string): Promise<string[]> {
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
      } else if (entry.isFile() && entry.name.endsWith(".email-message.card")) {
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

function convertOne(node: ElementNode, source: string): MessageFields {
  if (node.tagName !== "email-message") {
    throw new Error(`${source}: expected <email-message> root, got <${node.tagName}>`);
  }
  const messageId = node.attrs["message-id"];
  const threadId = node.attrs["thread-id"];
  if (messageId === undefined) throw new Error(`${source}: missing message-id`);
  if (threadId === undefined) throw new Error(`${source}: missing thread-id`);

  const from = childText(node, "from");
  if (from === undefined) throw new Error(`${source}: missing <from>`);

  const date = childText(node, "date");
  if (date === undefined) throw new Error(`${source}: missing <date>`);

  const subject = childText(node, "subject");
  if (subject === undefined) throw new Error(`${source}: missing <subject>`);

  const bodyFile = childText(node, "body-file");
  if (bodyFile === undefined) throw new Error(`${source}: missing <body-file>`);

  const fields: MessageFields = {
    type: "email-message",
    "message-id": messageId,
    "thread-id": threadId,
    from,
    date,
    subject,
    "body-file": { ref: bodyFile },
  };

  const to = childText(node, "to");
  if (to !== undefined && to !== "") fields.to = to;

  const cc = childText(node, "cc");
  if (cc !== undefined && cc !== "") fields.cc = cc;

  const snippet = childText(node, "snippet");
  if (snippet !== undefined && snippet !== "") fields.snippet = snippet;

  const attachmentsNode = firstChild(node, "attachments");
  if (attachmentsNode !== undefined && attachmentsNode.children.length > 0) {
    const list: AttachmentEntry[] = [];
    for (const item of attachmentsNode.children) {
      if (item.tagName !== "attachment") continue;
      const ref = item.attrs["ref"];
      const contentType = item.attrs["content-type"];
      if (ref === undefined || contentType === undefined) continue;
      const entry: AttachmentEntry = { ref, "content-type": contentType };
      const sizeAttr = item.attrs["size"];
      if (sizeAttr !== undefined) {
        const n = Number(sizeAttr);
        if (Number.isFinite(n)) entry.size = n;
      }
      list.push(entry);
    }
    if (list.length > 0) fields.attachments = list;
  }

  return fields;
}

async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
  const raw = await readFile(absPath, "utf8");
  if (/^---\r?\n[\s\S]*?\btype:\s*email-message\b/m.test(raw)) {
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
    console.error("Usage: migrate-email-message <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  const cards = await findMessageCards(absRoot);
  console.log(`Found ${String(cards.length)} *.email-message.card files under ${absRoot}`);

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
