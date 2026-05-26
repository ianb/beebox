#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Phase 2 (per-schema): migrate `.memo.card` files from Phase 1
 * frontmatter-with-XML-body to flat frontmatter + markdown body.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/memo.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/memo.ts <boxRoot> --apply
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseCard, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";

const SPEC: ElementSpec = {
  attrs: ["status", "version"],
  children: {
    created: { attrs: [] },
    source: { attrs: [] },
    context: { attrs: ["url", "title"] },
    transcription: { attrs: ["language", "transcribed-at"] },
    "transcription-error": { attrs: ["permanent", "code", "attempted-at"] },
    content: { attrs: [] },
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
      } else if (entry.isFile() && entry.name.endsWith(".memo.card")) {
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
  if (node.tagName !== "memo") {
    throw new Error(`${source}: expected <memo> root, got <${node.tagName}>`);
  }
  const fields: Record<string, unknown> = {
    type: "memo",
    status: node.attrs["status"] ?? "new",
  };

  const created = childText(node, "created");
  if (created === undefined) throw new Error(`${source}: missing <created>`);
  fields["created"] = created;

  const memoSource = childText(node, "source");
  if (memoSource !== undefined) fields["source"] = memoSource;

  const contextEl = firstChild(node, "context");
  if (contextEl !== undefined) {
    const ctx: Record<string, unknown> = {};
    if (contextEl.attrs["url"] !== undefined) ctx["url"] = contextEl.attrs["url"];
    if (contextEl.attrs["title"] !== undefined) ctx["title"] = contextEl.attrs["title"];
    if (contextEl.text !== undefined && contextEl.text !== "") ctx["text"] = contextEl.text;
    if (Object.keys(ctx).length > 0) fields["context"] = ctx;
  }

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

  const content = childText(node, "content");
  const body = content === undefined ? "" : content;
  return { fields, body };
}

async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
  const raw = await readFile(absPath, "utf8");
  if (/^---\r?\n[\s\S]*?\btype:\s*memo\b/m.test(raw)) {
    return "already-migrated";
  }
  const node = await parseCard(raw, { source: absPath });
  checkElement({ node, source: absPath, spec: SPEC, warnings });
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
    console.error("Usage: migrate-memo <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  const cards = await findCards(absRoot);
  console.log(`Found ${String(cards.length)} *.memo.card files under ${absRoot}`);
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
