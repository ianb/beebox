#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Phase 2 (per-schema): migrate `.todo-list.card`, `.telegram-message.card`,
 * and `.feedback.card` files from Phase 1 frontmatter-with-XML-body to flat
 * frontmatter. Feedback keeps its prose response in a markdown body; the
 * other two are pure frontmatter.
 *
 * Usage:
 *   npx tsx scripts/migrate/misc.ts <boxRoot>           # dry-run
 *   npx tsx scripts/migrate/misc.ts <boxRoot> --apply
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseCard, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";

const ITEM_SPEC: ElementSpec = {
  attrs: ["name", "status", "completed"],
  children: {
    details: { attrs: [] },
    "agent-notes": { attrs: [] },
    // self-recursive via constructor below
  },
};
ITEM_SPEC.children!.item = ITEM_SPEC;

const TODO_SPEC: ElementSpec = {
  attrs: ["name", "version"],
  children: {
    details: { attrs: [] },
    "agent-notes": { attrs: [] },
    item: ITEM_SPEC,
  },
};

const TELEGRAM_SPEC: ElementSpec = {
  attrs: ["status", "chat-id", "version"],
  children: {
    text: { attrs: [] },
    "reply-to": { attrs: [] },
    response: { attrs: ["sent-at", "message-id"] },
    error: { attrs: [] },
  },
};

const FEEDBACK_SPEC: ElementSpec = {
  attrs: ["type", "version"],
  children: {
    target: { attrs: ["ref"] },
    source: { attrs: [] },
    timestamp: { attrs: [] },
    transcription: { attrs: ["language", "transcribed-at"] },
    "transcription-error": { attrs: ["permanent", "code", "attempted-at"] },
    response: { attrs: [] },
    comment: { attrs: [] },
  },
};

const SPECS: Record<Kind, ElementSpec> = {
  "todo-list": TODO_SPEC,
  "telegram-message": TELEGRAM_SPEC,
  feedback: FEEDBACK_SPEC,
};

const warnings = new WarningCollector();

type Kind = "todo-list" | "telegram-message" | "feedback";

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
  const c = firstChild(node, tagName);
  if (c === undefined) return undefined;
  const t = c.text;
  return t === undefined || t === "" ? undefined : t;
}

function convertItem(node: ElementNode): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    name: node.attrs["name"] ?? "",
    status: node.attrs["status"] ?? "pending",
  };
  if (node.attrs["completed"] !== undefined) entry["completed"] = node.attrs["completed"];
  const details = childText(node, "details");
  if (details !== undefined) entry["details"] = details;
  const agentNotes = childText(node, "agent-notes");
  if (agentNotes !== undefined) entry["agent-notes"] = agentNotes;
  const subItems: Array<Record<string, unknown>> = [];
  for (const c of node.children) {
    if (c.tagName === "item") subItems.push(convertItem(c));
  }
  if (subItems.length > 0) entry["items"] = subItems;
  return entry;
}

function convertTodoList(node: ElementNode, source: string): Record<string, unknown> {
  if (node.tagName !== "todo-list") {
    throw new Error(`${source}: expected <todo-list> root, got <${node.tagName}>`);
  }
  const fields: Record<string, unknown> = {
    type: "todo-list",
    name: node.attrs["name"] ?? "",
  };
  const details = childText(node, "details");
  if (details !== undefined) fields["details"] = details;
  const agentNotes = childText(node, "agent-notes");
  if (agentNotes !== undefined) fields["agent-notes"] = agentNotes;
  const items: Array<Record<string, unknown>> = [];
  for (const c of node.children) {
    if (c.tagName === "item") items.push(convertItem(c));
  }
  if (items.length > 0) fields["items"] = items;
  return fields;
}

function convertTelegramMessage(node: ElementNode, source: string): Record<string, unknown> {
  if (node.tagName !== "telegram-message") {
    throw new Error(`${source}: expected <telegram-message> root, got <${node.tagName}>`);
  }
  const fields: Record<string, unknown> = {
    type: "telegram-message",
    status: node.attrs["status"] ?? "pending",
    "chat-id": node.attrs["chat-id"] ?? "",
    text: childText(node, "text") ?? "",
  };
  const replyTo = childText(node, "reply-to");
  if (replyTo !== undefined) {
    const n = Number(replyTo);
    if (Number.isFinite(n)) fields["reply-to"] = n;
  }
  const responseEl = firstChild(node, "response");
  if (responseEl !== undefined) {
    const sentAt = responseEl.attrs["sent-at"];
    const messageId = responseEl.attrs["message-id"];
    if (sentAt !== undefined && messageId !== undefined) {
      fields["response"] = { "sent-at": sentAt, "message-id": messageId };
    }
  }
  const errorText = childText(node, "error");
  if (errorText !== undefined) fields["error"] = errorText;
  return fields;
}

function convertFeedback(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
  if (node.tagName !== "feedback") {
    throw new Error(`${source}: expected <feedback> root, got <${node.tagName}>`);
  }
  const fields: Record<string, unknown> = { type: "feedback" };
  if (node.attrs["type"] !== undefined) fields["type-of-feedback"] = node.attrs["type"];

  const targetEl = firstChild(node, "target");
  if (targetEl === undefined || targetEl.attrs["ref"] === undefined) {
    throw new Error(`${source}: missing <target ref="...">`);
  }
  fields["target"] = { ref: targetEl.attrs["ref"] };

  const sourceText = childText(node, "source");
  if (sourceText === undefined) throw new Error(`${source}: missing <source>`);
  fields["source"] = sourceText;

  const timestamp = childText(node, "timestamp");
  if (timestamp === undefined) throw new Error(`${source}: missing <timestamp>`);
  fields["timestamp"] = timestamp;

  const transEl = firstChild(node, "transcription");
  if (transEl !== undefined && transEl.text !== undefined && transEl.text !== "") {
    const t: Record<string, unknown> = { text: transEl.text };
    if (transEl.attrs["language"] !== undefined) t["language"] = transEl.attrs["language"];
    if (transEl.attrs["transcribed-at"] !== undefined) t["transcribed-at"] = transEl.attrs["transcribed-at"];
    fields["transcription"] = t;
  }

  const errEl = firstChild(node, "transcription-error");
  if (errEl !== undefined && errEl.text !== undefined && errEl.text !== "") {
    const e: Record<string, unknown> = {
      permanent: errEl.attrs["permanent"] === "true",
      message: errEl.text,
    };
    if (errEl.attrs["code"] !== undefined) e["code"] = errEl.attrs["code"];
    if (errEl.attrs["attempted-at"] !== undefined) e["attempted-at"] = errEl.attrs["attempted-at"];
    fields["transcription-error"] = e;
  }

  // Body is the user's typed response/comment.
  const response = childText(node, "response");
  const comment = childText(node, "comment");
  const body = response ?? comment ?? "";
  return { fields, body };
}

async function migrateFile(absPath: string, kind: Kind): Promise<"converted" | "already-migrated"> {
  const raw = await readFile(absPath, "utf8");
  const typeMarker = `type:\\s*${kind}\\b`;
  const re = new RegExp(`^---\\r?\\n[\\s\\S]*?\\b${typeMarker}`, "m");
  if (re.test(raw)) return "already-migrated";
  const node = await parseCard(raw, { source: absPath });
  checkElement({ node, source: absPath, spec: SPECS[kind], warnings });
  let fields: Record<string, unknown>;
  let body = "";
  if (kind === "todo-list") {
    fields = convertTodoList(node, absPath);
  } else if (kind === "telegram-message") {
    fields = convertTelegramMessage(node, absPath);
  } else {
    const out = convertFeedback(node, absPath);
    fields = out.fields;
    body = out.body;
  }
  const yamlText = stringifyYaml(fields);
  const bodyTail = body === "" ? "" : `${body}${body.endsWith("\n") ? "" : "\n"}`;
  await writeFile(absPath, `---\n${yamlText}---\n${bodyTail}`);
  return "converted";
}

async function migrateKind(input: { absRoot: string; kind: Kind; apply: boolean }): Promise<void> {
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
    console.error("Usage: migrate-misc <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  await migrateKind({ absRoot, kind: "todo-list", apply });
  await migrateKind({ absRoot, kind: "telegram-message", apply });
  await migrateKind({ absRoot, kind: "feedback", apply });
  warnings.dump(absRoot);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
