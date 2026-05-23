#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Phase 2: migrate the four remaining job schemas to flat frontmatter.
 *
 *   .intake.job.card
 *   .calendar-review.job.card  (filename uses ".calendar-review-job.card" in some boxes)
 *   .question-followup.job.card / .question-followup-job.card
 *   .chat-job.card / .chat.job.card
 *
 * Usage:
 *   npx tsx scripts/migrate-jobs.ts <boxRoot>           # dry-run
 *   npx tsx scripts/migrate-jobs.ts <boxRoot> --apply
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseCard, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";

type Kind = "intake-job" | "calendar-review-job" | "chat-job" | "question-followup-job";

const SUFFIXES: Record<Kind, string[]> = {
  "intake-job": [".intake.job.card"],
  "calendar-review-job": [".calendar-review.job.card", ".calendar-review-job.card"],
  "chat-job": [".chat-job.card", ".chat.job.card"],
  "question-followup-job": [".question-followup.job.card", ".question-followup-job.card"],
};

async function findCards(root: string, suffixes: string[]): Promise<string[]> {
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
      } else if (entry.isFile() && suffixes.some((s) => entry.name.endsWith(s))) {
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

function convertIntakeJob(node: ElementNode, source: string): Record<string, unknown> {
  if (node.tagName !== "intake-job") {
    throw new Error(`${source}: expected <intake-job> root, got <${node.tagName}>`);
  }
  const fields: Record<string, unknown> = {
    type: "intake-job",
    status: node.attrs["status"] ?? "pending",
    created: node.attrs["created"] ?? "",
    source: node.attrs["source"] ?? "",
    priority: node.attrs["priority"] ?? "normal",
    description: childText(node, "description") ?? "",
  };
  const items: Array<{ ref: string }> = [];
  for (const c of node.children) {
    if (c.tagName !== "item") continue;
    const ref = c.attrs["ref"];
    if (ref !== undefined) items.push({ ref });
  }
  fields["items"] = items;
  return fields;
}

function convertCalendarReviewJob(node: ElementNode, source: string): Record<string, unknown> {
  if (node.tagName !== "calendar-review-job") {
    throw new Error(`${source}: expected <calendar-review-job> root, got <${node.tagName}>`);
  }
  const fields: Record<string, unknown> = {
    type: "calendar-review-job",
    status: node.attrs["status"] ?? "pending",
    created: node.attrs["created"] ?? "",
    source: node.attrs["source"] ?? "",
    priority: node.attrs["priority"] ?? "normal",
    description: childText(node, "description") ?? "",
  };
  const changes: Array<Record<string, unknown>> = [];
  for (const c of node.children) {
    if (c.tagName !== "change") continue;
    const action = c.attrs["action"];
    if (action === undefined) continue;
    const entry: Record<string, unknown> = {
      action,
      summary: (c.text ?? "").trim(),
    };
    if (c.attrs["ref"] !== undefined) entry["ref"] = c.attrs["ref"];
    const icsEl = firstChild(c, "ics");
    if (icsEl !== undefined && icsEl.text !== undefined) entry["ics"] = icsEl.text;
    changes.push(entry);
  }
  fields["changes"] = changes;
  return fields;
}

function convertChatJob(node: ElementNode, source: string): Record<string, unknown> {
  if (node.tagName !== "chat-job") {
    throw new Error(`${source}: expected <chat-job> root, got <${node.tagName}>`);
  }
  const threadEl = firstChild(node, "thread");
  const threadRef = threadEl?.attrs["ref"] ?? "";
  return {
    type: "chat-job",
    status: node.attrs["status"] ?? "pending",
    created: node.attrs["created"] ?? "",
    source: node.attrs["source"] ?? "",
    description: childText(node, "description") ?? "",
    thread: { ref: threadRef },
  };
}

function convertQuestionFollowupJob(node: ElementNode, source: string): Record<string, unknown> {
  if (node.tagName !== "question-followup-job") {
    throw new Error(`${source}: expected <question-followup-job> root, got <${node.tagName}>`);
  }
  const qrefEl = firstChild(node, "question-ref");
  return {
    type: "question-followup-job",
    status: node.attrs["status"] ?? "pending",
    created: node.attrs["created"] ?? "",
    source: node.attrs["source"] ?? "question-answer",
    description: childText(node, "description") ?? "",
    "question-ref": { ref: qrefEl?.attrs["ref"] ?? "" },
    directive: childText(node, "directive") ?? "",
    answer: childText(node, "answer") ?? "",
  };
}

const CONVERTERS: Record<Kind, (n: ElementNode, src: string) => Record<string, unknown>> = {
  "intake-job": convertIntakeJob,
  "calendar-review-job": convertCalendarReviewJob,
  "chat-job": convertChatJob,
  "question-followup-job": convertQuestionFollowupJob,
};

async function migrateFile(absPath: string, kind: Kind): Promise<"converted" | "already-migrated"> {
  const raw = await readFile(absPath, "utf8");
  const typeMarker = `type:\\s*${kind}\\b`;
  const re = new RegExp(`^---\\r?\\n[\\s\\S]*?\\b${typeMarker}`, "m");
  if (re.test(raw)) return "already-migrated";
  const node = await parseCard(raw, { source: absPath });
  const fields = CONVERTERS[kind](node, absPath);
  await writeFile(absPath, `---\n${stringifyYaml(fields)}---\n`);
  return "converted";
}

async function migrateKind(input: { absRoot: string; kind: Kind; apply: boolean }): Promise<void> {
  const { absRoot, kind, apply } = input;
  const suffixes = SUFFIXES[kind];
  const cards = await findCards(absRoot, suffixes);
  console.log(`Found ${String(cards.length)} ${kind} cards under ${absRoot}`);
  if (!apply) return;
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
  for (const f of failed.slice(0, 10)) {
    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.filter((a) => !a.startsWith("--"));
  const boxRoot = positional[0];
  if (boxRoot === undefined) {
    console.error("Usage: migrate-jobs <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  for (const kind of Object.keys(SUFFIXES) as Kind[]) {
    await migrateKind({ absRoot, kind, apply });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
