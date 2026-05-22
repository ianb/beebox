#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Phase 2 (per-schema): migrate `.news-item.card` files from Phase 1
 * frontmatter-with-XML-body to flat frontmatter + markdown body.
 *
 * Usage:
 *   npx tsx scripts/migrate-news-item.ts <boxRoot>           # dry-run
 *   npx tsx scripts/migrate-news-item.ts <boxRoot> --apply
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseCard, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";

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
      } else if (entry.isFile() && entry.name.endsWith(".news-item.card")) {
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

function convertOne(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
  if (node.tagName !== "news-item") {
    throw new Error(`${source}: expected <news-item> root, got <${node.tagName}>`);
  }
  const fields: Record<string, unknown> = { type: "news-item" };
  if (node.attrs["status"] !== undefined) fields["status"] = node.attrs["status"];
  if (node.attrs["source"] !== undefined) fields["source"] = node.attrs["source"];

  const title = childText(node, "title");
  if (title === undefined) throw new Error(`${source}: missing <title>`);
  fields["title"] = title;

  const link = childText(node, "link");
  if (link === undefined) throw new Error(`${source}: missing <link>`);
  fields["link"] = link;

  const published = childText(node, "published");
  if (published === undefined) throw new Error(`${source}: missing <published>`);
  fields["published"] = published;

  const feedEl = firstChild(node, "feed");
  if (feedEl !== undefined) {
    const feed: Record<string, unknown> = { title: feedEl.text ?? "" };
    if (feedEl.attrs["url"] !== undefined) feed["url"] = feedEl.attrs["url"];
    fields["feed"] = feed;
  }

  const summary = childText(node, "summary");
  if (summary !== undefined) fields["summary"] = summary;
  const author = childText(node, "author");
  if (author !== undefined) fields["author"] = author;
  const guid = childText(node, "guid");
  if (guid !== undefined) fields["guid"] = guid;
  const comments = childText(node, "comments");
  if (comments !== undefined) fields["comments"] = comments;

  const contentEl = firstChild(node, "content");
  let body = "";
  if (contentEl !== undefined) {
    body = contentEl.text ?? "";
    const fetchedAt = contentEl.attrs["fetched-at"];
    if (fetchedAt !== undefined) {
      const fetched: Record<string, unknown> = { at: fetchedAt };
      if (contentEl.attrs["fetched-url"] !== undefined) fetched["url"] = contentEl.attrs["fetched-url"];
      fields["fetched"] = fetched;
    }
  }

  const fetchErrorEl = firstChild(node, "fetch-error");
  if (fetchErrorEl !== undefined) {
    const err: Record<string, unknown> = {
      "attempted-at": fetchErrorEl.attrs["attempted-at"] ?? "",
      message: fetchErrorEl.text ?? "",
    };
    if (fetchErrorEl.attrs["status-code"] !== undefined) {
      const n = Number(fetchErrorEl.attrs["status-code"]);
      if (Number.isFinite(n)) err["status-code"] = n;
    }
    fields["fetch-error"] = err;
  }

  const analysisEl = firstChild(node, "analysis");
  if (analysisEl !== undefined) {
    const analysis: Record<string, unknown> = {
      "analyzed-at": analysisEl.attrs["analyzed-at"] ?? "",
    };
    const topicsEl = firstChild(analysisEl, "topics");
    if (topicsEl !== undefined) {
      const topics: string[] = [];
      for (const t of topicsEl.children) {
        if (t.tagName === "topic" && t.text !== undefined) topics.push(t.text);
      }
      if (topics.length > 0) analysis["topics"] = topics;
    }
    const questionsEl = firstChild(analysisEl, "questions");
    if (questionsEl !== undefined) {
      const questions: string[] = [];
      for (const q of questionsEl.children) {
        if (q.tagName === "question" && q.text !== undefined) questions.push(q.text);
      }
      if (questions.length > 0) analysis["questions"] = questions;
    }
    for (const tag of ["type", "thesis", "tone", "timeliness", "notes"]) {
      const t = childText(analysisEl, tag);
      if (t !== undefined) analysis[tag] = t;
    }
    fields["analysis"] = analysis;
  }

  return { fields, body };
}

async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
  const raw = await readFile(absPath, "utf8");
  if (/^---\r?\n[\s\S]*?\btype:\s*news-item\b/m.test(raw)) {
    return "already-migrated";
  }
  const node = await parseCard(raw, { source: absPath });
  const { fields, body } = convertOne(node, absPath);
  const yamlText = stringifyYaml(fields);
  const bodyTail = body === "" ? "" : `${body}${body.endsWith("\n") ? "" : "\n"}`;
  await writeFile(absPath, `---\n${yamlText}---\n${bodyTail}`);
  return "converted";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.filter((a) => !a.startsWith("--"));
  const boxRoot = positional[0];
  if (boxRoot === undefined) {
    console.error("Usage: migrate-news-item <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  const cards = await findCards(absRoot);
  console.log(`Found ${String(cards.length)} *.news-item.card files under ${absRoot}`);
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
  for (const f of failed.slice(0, 20)) {
    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
  }
  if (failed.length > 20) console.log(`  ... and ${String(failed.length - 20)} more`);
  if (failed.length > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
