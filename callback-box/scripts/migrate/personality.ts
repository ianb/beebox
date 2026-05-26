#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Phase 2: migrate `.personality.card` files from Phase 1
 * frontmatter-with-XML-body to flat frontmatter + markdown body.
 *
 * Usage:
 *   npx tsx scripts/migrate/personality.ts <boxRoot>           # dry-run
 *   npx tsx scripts/migrate/personality.ts <boxRoot> --apply
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseCard, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";

const EVIDENCE_ATTRS = ["confidence", "source", "ref"];

const EXPERIMENT_SPEC: ElementSpec = {
  attrs: ["id", "status", "created-at", "updated-at"],
  children: {
    hypothesis: { attrs: [] },
    approach: { attrs: [] },
    observation: { attrs: ["ref", "date"] },
    conclusion: { attrs: [] },
  },
};

const SPEC: ElementSpec = {
  attrs: ["version"],
  children: {
    "goes-by": { attrs: [] },
    role: { attrs: [] },
    boxholder: {
      attrs: ["ref"],
      children: {
        "full-name": { attrs: [] },
        called: { attrs: [] },
        relationship: { attrs: EVIDENCE_ATTRS },
      },
    },
    "speaking-voice": {
      attrs: ["model"],
      children: { instruction: { attrs: [] } },
    },
    tone: {
      attrs: [],
      children: { instruction: { attrs: EVIDENCE_ATTRS } },
    },
    traits: {
      attrs: [],
      children: {
        trait: { attrs: EVIDENCE_ATTRS },
        unresolved: { attrs: [], children: { note: { attrs: [] } } },
        description: { attrs: [] },
      },
    },
    experiments: {
      attrs: [],
      children: { experiment: EXPERIMENT_SPEC },
    },
    "context-notes": {
      attrs: [],
      children: { context: { attrs: ["duration", "added-at"] } },
    },
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
      } else if (entry.isFile() && entry.name.endsWith(".personality.card")) {
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

function convertWithEvidence(node: ElementNode): Record<string, unknown> {
  const out: Record<string, unknown> = { text: node.text ?? "" };
  if (node.attrs["confidence"] !== undefined) out["confidence"] = node.attrs["confidence"];
  if (node.attrs["source"] !== undefined) out["source"] = node.attrs["source"];
  if (node.attrs["ref"] !== undefined) out["ref"] = node.attrs["ref"];
  return out;
}

function convertExperiment(node: ElementNode): Record<string, unknown> {
  const out: Record<string, unknown> = { id: node.attrs["id"] ?? "" };
  if (node.attrs["status"] !== undefined) out["status"] = node.attrs["status"];
  if (node.attrs["created-at"] !== undefined) out["created-at"] = node.attrs["created-at"];
  if (node.attrs["updated-at"] !== undefined) out["updated-at"] = node.attrs["updated-at"];
  const hypothesis = childText(node, "hypothesis");
  if (hypothesis !== undefined) out["hypothesis"] = hypothesis;
  const approach = childText(node, "approach");
  if (approach !== undefined) out["approach"] = approach;
  const observations: Array<Record<string, unknown>> = [];
  for (const o of node.children) {
    if (o.tagName !== "observation") continue;
    const entry: Record<string, unknown> = { text: o.text ?? "" };
    if (o.attrs["ref"] !== undefined) entry["ref"] = o.attrs["ref"];
    if (o.attrs["date"] !== undefined) entry["date"] = o.attrs["date"];
    observations.push(entry);
  }
  if (observations.length > 0) out["observations"] = observations;
  const conclusion = childText(node, "conclusion");
  if (conclusion !== undefined) out["conclusion"] = conclusion;
  return out;
}

function convertOne(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
  if (node.tagName !== "personality") {
    throw new Error(`${source}: expected <personality> root, got <${node.tagName}>`);
  }
  const fields: Record<string, unknown> = {
    type: "personality",
    version: node.attrs["version"] ?? "1.0.0",
  };

  const goesBy = childText(node, "goes-by");
  if (goesBy !== undefined) fields["goes-by"] = goesBy;
  const role = childText(node, "role");
  if (role !== undefined) fields["role"] = role;

  const boxholderEl = firstChild(node, "boxholder");
  if (boxholderEl !== undefined) {
    const bh: Record<string, unknown> = {};
    if (boxholderEl.attrs["ref"] !== undefined) bh["ref"] = boxholderEl.attrs["ref"];
    const fullName = childText(boxholderEl, "full-name");
    if (fullName !== undefined) bh["full-name"] = fullName;
    const called = childText(boxholderEl, "called");
    if (called !== undefined) bh["called"] = called;
    const relationships: Array<Record<string, unknown>> = [];
    for (const r of boxholderEl.children) {
      if (r.tagName !== "relationship") continue;
      relationships.push(convertWithEvidence(r));
    }
    if (relationships.length > 0) bh["relationships"] = relationships;
    if (Object.keys(bh).length > 0) fields["boxholder"] = bh;
  }

  const svEl = firstChild(node, "speaking-voice");
  if (svEl !== undefined) {
    const sv: Record<string, unknown> = {};
    if (svEl.attrs["model"] !== undefined) sv["model"] = svEl.attrs["model"];
    const instructions: string[] = [];
    for (const i of svEl.children) {
      if (i.tagName === "instruction" && i.text !== undefined) instructions.push(i.text);
    }
    if (instructions.length > 0) sv["instructions"] = instructions;
    if (Object.keys(sv).length > 0) fields["speaking-voice"] = sv;
  }

  const toneEl = firstChild(node, "tone");
  if (toneEl !== undefined) {
    const tone: Array<Record<string, unknown>> = [];
    for (const i of toneEl.children) {
      if (i.tagName === "instruction") tone.push(convertWithEvidence(i));
    }
    if (tone.length > 0) fields["tone"] = tone;
  }

  const traitsEl = firstChild(node, "traits");
  let body = "";
  if (traitsEl !== undefined) {
    const traits: Array<Record<string, unknown>> = [];
    for (const t of traitsEl.children) {
      if (t.tagName === "trait") traits.push(convertWithEvidence(t));
    }
    if (traits.length > 0) fields["traits"] = traits;
    const unresolvedEl = firstChild(traitsEl, "unresolved");
    if (unresolvedEl !== undefined) {
      const notes: string[] = [];
      for (const n of unresolvedEl.children) {
        if (n.tagName === "note" && n.text !== undefined) notes.push(n.text);
      }
      if (notes.length > 0) fields["unresolved"] = notes;
    }
    const descEl = firstChild(traitsEl, "description");
    if (descEl !== undefined && descEl.text !== undefined) {
      body = descEl.text;
    }
  }

  const experimentsEl = firstChild(node, "experiments");
  if (experimentsEl !== undefined) {
    const experiments: Array<Record<string, unknown>> = [];
    for (const e of experimentsEl.children) {
      if (e.tagName === "experiment") experiments.push(convertExperiment(e));
    }
    if (experiments.length > 0) fields["experiments"] = experiments;
  }

  const contextEl = firstChild(node, "context-notes");
  if (contextEl !== undefined) {
    const notes: Array<Record<string, unknown>> = [];
    for (const c of contextEl.children) {
      if (c.tagName !== "context") continue;
      const entry: Record<string, unknown> = { text: c.text ?? "" };
      if (c.attrs["duration"] !== undefined) entry["duration"] = c.attrs["duration"];
      if (c.attrs["added-at"] !== undefined) entry["added-at"] = c.attrs["added-at"];
      notes.push(entry);
    }
    if (notes.length > 0) fields["context-notes"] = notes;
  }

  return { fields, body };
}

async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
  const raw = await readFile(absPath, "utf8");
  if (/^---\r?\n[\s\S]*?\btype:\s*personality\b/m.test(raw)) {
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
    console.error("Usage: migrate-personality <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  const cards = await findCards(absRoot);
  console.log(`Found ${String(cards.length)} *.personality.card files under ${absRoot}`);
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
  warnings.dump(absRoot);
  if (failed.length > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
