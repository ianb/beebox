#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Phase 2: migrate `.question.card` files from XML to YAML frontmatter.
 *
 * Usage:
 *   npx tsx scripts/migrate-question.ts <boxRoot>           # dry-run
 *   npx tsx scripts/migrate-question.ts <boxRoot> --apply
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
      } else if (entry.isFile() && entry.name.endsWith(".question.card")) {
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
  if (node.tagName !== "question") {
    throw new Error(`${source}: expected <question>, got <${node.tagName}>`);
  }
  const fields: Record<string, unknown> = { type: "question" };

  fields["status"] = node.attrs["status"] ?? "pending";
  if (node.attrs["answered-by"] !== undefined) {
    fields["answered-by"] = node.attrs["answered-by"];
  }

  const memo = childText(node, "memo");
  if (memo !== undefined) fields["memo"] = memo;

  const prompt = childText(node, "prompt");
  if (prompt !== undefined) fields["prompt"] = prompt;

  const inputEl = node.children.find((c) => c.tagName === "input");
  if (inputEl !== undefined) {
    const input: Record<string, unknown> = {
      type: inputEl.attrs["type"] ?? "text",
    };
    const options = inputEl.children
      .filter((c) => c.tagName === "option")
      .map((c) => ({
        id: c.attrs["id"] ?? "",
        label: c.text ?? "",
      }));
    if (options.length > 0) input["options"] = options;
    fields["input"] = input;
  } else {
    fields["input"] = { type: "text" };
  }

  const directive = childText(node, "directive");
  if (directive !== undefined) fields["directive"] = directive;

  const contexts = node.children.filter((c) => c.tagName === "context");
  if (contexts.length > 0) {
    fields["context"] = contexts.map((c) => {
      const entry: Record<string, unknown> = { ref: c.attrs["ref"] ?? "" };
      if (c.text !== undefined && c.text !== "") entry["text"] = c.text;
      return entry;
    });
  }

  const answerEl = node.children.find((c) => c.tagName === "answer");
  if (answerEl !== undefined) {
    const answer: Record<string, unknown> = {};
    if (answerEl.text !== undefined && answerEl.text !== "") answer["text"] = answerEl.text;
    if (answerEl.attrs["selected"] !== undefined) answer["selected"] = answerEl.attrs["selected"];
    if (Object.keys(answer).length > 0) fields["answer"] = answer;
  }

  const answeredAt = childText(node, "answered-at");
  if (answeredAt !== undefined) fields["answered-at"] = answeredAt;

  const answeredVia = childText(node, "answered-via");
  if (answeredVia !== undefined) fields["answered-via"] = answeredVia;

  return fields;
}

async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
  const raw = await readFile(absPath, "utf8");
  if (/^---\r?\n[\s\S]*?\btype:\s*question\b/m.test(raw)) {
    return "already-migrated";
  }
  const node = await parseCard(raw, { source: absPath });
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
    console.error("Usage: migrate-question <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  const cards = await findCards(absRoot);
  console.log(`Found ${String(cards.length)} *.question.card files under ${absRoot}`);
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
  if (failed.length > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
