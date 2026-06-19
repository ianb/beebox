#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Phase 2 (per-schema): migrate `.record.card` and `.person.card` files
 * from Phase 1 frontmatter-with-XML-body to flat frontmatter + markdown
 * body.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/record-person.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/record-person.ts <boxRoot> --apply
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseCard, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";

const RECORD_SPEC: ElementSpec = {
  attrs: ["status", "version"],
  children: {
    name: { attrs: [] },
    description: { attrs: [] },
    sources: {
      attrs: [],
      children: { source: { attrs: ["ref", "time"] } },
    },
    date: { attrs: ["value"] },
    person: { attrs: ["name", "ref", "role", "notes"] },
    location: { attrs: ["ref"] },
    measure: { attrs: ["value"] },
    language: { attrs: [] },
    triage: { attrs: [] },
    notes: { attrs: [] },
    content: { attrs: [] },
  },
};

const PERSON_SPEC: ElementSpec = {
  attrs: ["status", "version"],
  children: {
    name: { attrs: [] },
    called: { attrs: [] },
    role: { attrs: [] },
    contact: { attrs: [] },
    notes: { attrs: [] },
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
  const c = firstChild(node, tagName);
  if (c === undefined) return undefined;
  const t = c.text;
  return t === undefined || t === "" ? undefined : t;
}

function convertRecord(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
  if (node.tagName !== "record") {
    throw new Error(`${source}: expected <record> root, got <${node.tagName}>`);
  }
  const fields: Record<string, unknown> = {
    type: "record",
    status: node.attrs["status"] ?? "draft",
  };
  const name = childText(node, "name");
  if (name === undefined) throw new Error(`${source}: missing <name>`);
  fields["name"] = name;

  const description = childText(node, "description");
  if (description !== undefined) fields["description"] = description;

  // sources
  const sourcesEl = firstChild(node, "sources");
  if (sourcesEl !== undefined && sourcesEl.children.length > 0) {
    const list: Array<Record<string, unknown>> = [];
    for (const s of sourcesEl.children) {
      if (s.tagName !== "source") continue;
      const ref = s.attrs["ref"];
      if (ref === undefined) continue;
      const entry: Record<string, unknown> = { ref };
      if (s.attrs["time"] !== undefined) entry["time"] = s.attrs["time"];
      if (s.text !== undefined && s.text !== "") entry["note"] = s.text;
      list.push(entry);
    }
    if (list.length > 0) fields["sources"] = list;
  }

  // dates (multiple)
  const dates: Array<Record<string, unknown>> = [];
  for (const c of node.children) {
    if (c.tagName !== "date") continue;
    const value = c.attrs["value"];
    if (value === undefined) continue;
    const entry: Record<string, unknown> = { value };
    if (c.text !== undefined && c.text !== "") entry["note"] = c.text;
    dates.push(entry);
  }
  if (dates.length > 0) fields["dates"] = dates;

  // persons
  const persons: Array<Record<string, unknown>> = [];
  for (const c of node.children) {
    if (c.tagName !== "person") continue;
    const personName = c.attrs["name"];
    if (personName === undefined) continue;
    const entry: Record<string, unknown> = { name: personName };
    if (c.attrs["ref"] !== undefined) entry["ref"] = c.attrs["ref"];
    if (c.attrs["role"] !== undefined) entry["role"] = c.attrs["role"];
    if (c.attrs["notes"] !== undefined) entry["notes"] = c.attrs["notes"];
    if (c.text !== undefined && c.text !== "") entry["note"] = c.text;
    persons.push(entry);
  }
  if (persons.length > 0) fields["persons"] = persons;

  // location
  const locationEl = firstChild(node, "location");
  if (locationEl !== undefined) {
    const loc: Record<string, unknown> = {};
    if (locationEl.attrs["ref"] !== undefined) loc["ref"] = locationEl.attrs["ref"];
    if (locationEl.text !== undefined && locationEl.text !== "") loc["text"] = locationEl.text;
    if (Object.keys(loc).length > 0) fields["location"] = loc;
  }

  // measures
  const measures: Array<Record<string, unknown>> = [];
  for (const c of node.children) {
    if (c.tagName !== "measure") continue;
    const value = c.attrs["value"];
    if (value === undefined) continue;
    const entry: Record<string, unknown> = { value };
    if (c.text !== undefined && c.text !== "") entry["note"] = c.text;
    measures.push(entry);
  }
  if (measures.length > 0) fields["measures"] = measures;

  const language = childText(node, "language");
  if (language !== undefined) fields["language"] = language;

  const triage = childText(node, "triage");
  if (triage !== undefined) fields["triage"] = triage;

  const notes = childText(node, "notes");
  if (notes !== undefined) fields["notes"] = notes;

  const contentText = childText(node, "content");
  const body = contentText === undefined ? "" : contentText;

  return { fields, body };
}

function convertPerson(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
  if (node.tagName !== "person") {
    throw new Error(`${source}: expected <person> root, got <${node.tagName}>`);
  }
  const fields: Record<string, unknown> = {
    type: "person",
    status: node.attrs["status"] ?? "active",
  };
  const name = childText(node, "name");
  if (name === undefined) throw new Error(`${source}: missing <name>`);
  fields["name"] = name;

  const calleds: string[] = [];
  for (const c of node.children) {
    if (c.tagName !== "called") continue;
    if (c.text !== undefined && c.text !== "") calleds.push(c.text);
  }
  if (calleds.length > 0) fields["called"] = calleds;

  const role = childText(node, "role");
  if (role !== undefined) fields["role"] = role;

  const contact = childText(node, "contact");
  if (contact !== undefined) fields["contact"] = contact;

  const notes = childText(node, "notes");
  const body = notes === undefined ? "" : notes;

  return { fields, body };
}

async function migrateFile(
  absPath: string,
  kind: "record" | "person"
): Promise<"converted" | "already-migrated"> {
  const raw = await readFile(absPath, "utf8");
  // Already frontmatter (or empty/degenerate) — only an XML card starts with "<".
  if (!raw.trimStart().startsWith("<")) return "already-migrated";
  const node = await parseCard(raw, { source: absPath });
  checkElement({ node, source: absPath, spec: kind === "record" ? RECORD_SPEC : PERSON_SPEC, warnings });
  const { fields, body } = kind === "record"
    ? convertRecord(node, absPath)
    : convertPerson(node, absPath);
  const yamlText = stringifyYaml(fields);
  const bodyTail = body === "" ? "" : `${body}${body.endsWith("\n") ? "" : "\n"}`;
  await writeFile(absPath, `---\n${yamlText}---\n${bodyTail}`);
  return "converted";
}

async function migrateKind(input: {
  absRoot: string;
  kind: "record" | "person";
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
    console.error("Usage: migrate-record-person <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  await migrateKind({ absRoot, kind: "record", apply });
  await migrateKind({ absRoot, kind: "person", apply });
  warnings.dump(absRoot);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
