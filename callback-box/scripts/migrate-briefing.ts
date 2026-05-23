#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Phase 2 (per-schema): migrate `briefing.briefing.card` files from
 * Phase 1 frontmatter-with-XML-body to flat frontmatter + markdown body.
 *
 * Usage:
 *   npx tsx scripts/migrate-briefing.ts <boxRoot>           # dry-run
 *   npx tsx scripts/migrate-briefing.ts <boxRoot> --apply
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseCard, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { WarningCollector, checkElement, type ElementSpec } from "./_migrate-warnings.js";

const SPEC: ElementSpec = {
  attrs: ["version"],
  children: {
    purpose: { attrs: [] },
    "key-people": {
      attrs: [],
      children: { person: { attrs: ["name", "called", "role", "ref"] } },
    },
    "project-phase": { attrs: ["date"] },
    corrections: {
      attrs: [],
      children: {
        correction: {
          attrs: [],
          children: {
            instruction: { attrs: [] },
            test: { attrs: [] },
          },
        },
      },
    },
    legal: { attrs: [] },
    properties: {
      attrs: [],
      children: {
        property: { attrs: ["name", "address", "address-uncertain"] },
      },
    },
    finances: { attrs: [] },
    "agent-needs-to-know": { attrs: [] },
  },
};

const warnings = new WarningCollector();

interface PersonEntry {
  name: string;
  called?: string;
  role?: string;
  ref?: string;
  description?: string;
}

interface PropertyEntry {
  name?: string;
  address?: string;
  "address-uncertain"?: boolean;
  description?: string;
}

interface BriefingOut {
  type: "briefing";
  purpose?: string;
  "key-people"?: PersonEntry[];
  "project-phase"?: { date: string; text: string };
  corrections?: Array<{ instruction: string; test?: string }>;
  legal?: string;
  properties?: PropertyEntry[];
  finances?: string;
}

async function findBriefingCards(root: string): Promise<string[]> {
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
      } else if (entry.isFile() && entry.name.endsWith(".briefing.card")) {
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

function convertOne(node: ElementNode, source: string): { fields: BriefingOut; body: string } {
  if (node.tagName !== "briefing") {
    throw new Error(`${source}: expected <briefing> root, got <${node.tagName}>`);
  }
  const fields: BriefingOut = { type: "briefing" };

  const purposeEl = firstChild(node, "purpose");
  if (purposeEl !== undefined && purposeEl.text !== undefined && purposeEl.text !== "") {
    fields.purpose = purposeEl.text;
  }

  const keyPeopleEl = firstChild(node, "key-people");
  if (keyPeopleEl !== undefined && keyPeopleEl.children.length > 0) {
    const people: PersonEntry[] = [];
    for (const p of keyPeopleEl.children) {
      if (p.tagName !== "person") continue;
      const entry: PersonEntry = { name: p.attrs["name"] ?? "" };
      if (entry.name === "") continue;
      if (p.attrs["called"] !== undefined) entry.called = p.attrs["called"];
      if (p.attrs["role"] !== undefined) entry.role = p.attrs["role"];
      if (p.attrs["ref"] !== undefined) entry.ref = p.attrs["ref"];
      if (p.text !== undefined && p.text !== "") entry.description = p.text;
      people.push(entry);
    }
    if (people.length > 0) fields["key-people"] = people;
  }

  const phaseEl = firstChild(node, "project-phase");
  if (phaseEl !== undefined) {
    const date = phaseEl.attrs["date"];
    if (date !== undefined && phaseEl.text !== undefined) {
      fields["project-phase"] = { date, text: phaseEl.text };
    }
  }

  const correctionsEl = firstChild(node, "corrections");
  if (correctionsEl !== undefined && correctionsEl.children.length > 0) {
    const out: Array<{ instruction: string; test?: string }> = [];
    for (const c of correctionsEl.children) {
      if (c.tagName !== "correction") continue;
      const instr = firstChild(c, "instruction");
      const testEl = firstChild(c, "test");
      if (instr !== undefined && instr.text !== undefined && instr.text !== "") {
        const entry: { instruction: string; test?: string } = { instruction: instr.text };
        if (testEl !== undefined && testEl.text !== undefined && testEl.text !== "") {
          entry.test = testEl.text;
        }
        out.push(entry);
      }
    }
    if (out.length > 0) fields.corrections = out;
  }

  const legalEl = firstChild(node, "legal");
  if (legalEl !== undefined && legalEl.text !== undefined && legalEl.text.trim() !== "") {
    fields.legal = legalEl.text.trim();
  }

  const propertiesEl = firstChild(node, "properties");
  if (propertiesEl !== undefined && propertiesEl.children.length > 0) {
    const props: PropertyEntry[] = [];
    for (const p of propertiesEl.children) {
      if (p.tagName !== "property") continue;
      const entry: PropertyEntry = {};
      if (p.attrs["name"] !== undefined) entry.name = p.attrs["name"];
      if (p.attrs["address"] !== undefined) entry.address = p.attrs["address"];
      if (p.attrs["address-uncertain"] === "true") entry["address-uncertain"] = true;
      if (p.text !== undefined && p.text.trim() !== "") entry.description = p.text.trim();
      if (Object.keys(entry).length > 0) props.push(entry);
    }
    if (props.length > 0) fields.properties = props;
  }

  const financesEl = firstChild(node, "finances");
  if (financesEl !== undefined && financesEl.text !== undefined && financesEl.text.trim() !== "") {
    fields.finances = financesEl.text.trim();
  }

  const needsToKnow = firstChild(node, "agent-needs-to-know");
  const body = needsToKnow !== undefined && needsToKnow.text !== undefined ? needsToKnow.text : "";

  return { fields, body };
}

async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
  const raw = await readFile(absPath, "utf8");
  if (/^---\r?\n[\s\S]*?\btype:\s*briefing\b/m.test(raw)) {
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
    console.error("Usage: migrate-briefing <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  const cards = await findBriefingCards(absRoot);
  console.log(`Found ${String(cards.length)} *.briefing.card files under ${absRoot}`);

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
