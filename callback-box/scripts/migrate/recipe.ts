#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Migrate `.recipe.card` files from the XML body format to Phase-2
 * frontmatter + Markdoc-annotated body.
 *
 * Old (XML):
 *   <recipe>
 *     <title>Classic Beef Stew</title>
 *     <yield amount="6">6 servings</yield>
 *     <notes>- Source: …\n- Prep Time: …</notes>
 *     <section>
 *       <ingredients><ing amount="2" unit="lbs">beef chuck</ing>…</ingredients>
 *       <steps><step>Season the beef…</step>…</steps>
 *     </section>
 *   </recipe>
 *
 * New (frontmatter + Markdoc body):
 *   ---
 *   title: Classic Beef Stew
 *   source: https://example.com/…       # lifted from a "Source:" note, if present
 *   ---
 *   {% yield amount="6" %}6 servings{% /yield %}
 *
 *   ## Ingredients
 *   - {% ingredient amount="2" unit="lbs" %}beef chuck{% /ingredient %}
 *
 *   ## Steps
 *   {% step %}Season the beef…{% /step %}
 *
 *   ## Notes
 *   - Prep Time: …
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/recipe.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/recipe.ts <boxRoot> --apply
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseCard, splitCardContent, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { runMigration } from "./_harness.js";
import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";

const SPEC: ElementSpec = {
  attrs: [],
  children: {
    title: { attrs: [] },
    description: { attrs: [] },
    source: { attrs: [] },
    yield: { attrs: ["amount", "unit"] },
    notes: { attrs: [] },
    section: {
      attrs: ["name"],
      children: {
        ingredients: { attrs: [], children: { ing: { attrs: ["amount", "unit"] } } },
        steps: { attrs: [], children: { step: { attrs: [] } } },
      },
    },
  },
};

function text(el: ElementNode): string {
  return typeof el.text === "string" ? el.text.trim() : "";
}

function child(el: ElementNode, tag: string): ElementNode | undefined {
  return el.children.find((c) => c.tagName === tag);
}

function attrPart(el: ElementNode, name: string): string {
  const v = el.attrs[name];
  if (typeof v !== "string" || v === "") return "";
  return ` ${name}="${v}"`;
}

function ingredientTag(ing: ElementNode): string {
  const attrs = `${attrPart(ing, "amount")}${attrPart(ing, "unit")}`;
  return `- {% ingredient${attrs} %}${text(ing)}{% /ingredient %}`;
}

function sectionBody(section: ElementNode): string {
  const lines: string[] = [];
  const name = section.attrs["name"];
  if (typeof name === "string" && name !== "") lines.push(`{% recipe-section name="${name}" %}`, "");

  const ingredients = child(section, "ingredients");
  if (ingredients) {
    lines.push("## Ingredients", "");
    for (const ing of ingredients.children) {
      if (ing.tagName === "ing") lines.push(ingredientTag(ing));
    }
    lines.push("");
  }

  const steps = child(section, "steps");
  if (steps) {
    lines.push("## Steps", "");
    for (const step of steps.children) {
      if (step.tagName === "step") lines.push(`{% step %}${text(step)}{% /step %}`, "");
    }
  }

  if (typeof name === "string" && name !== "") lines.push("{% /recipe-section %}", "");
  return lines.join("\n");
}

const SOURCE_NOTE_RE = /^-?\s*source:\s*(.+)$/i;

/** Split notes into a possible source value and the remaining note lines. */
function splitNotes(notesText: string): { source: string | undefined; rest: string } {
  let source: string | undefined;
  const kept: string[] = [];
  for (const line of notesText.split("\n")) {
    const m = SOURCE_NOTE_RE.exec(line.trim());
    if (m && source === undefined) {
      source = m[1].trim();
      continue;
    }
    kept.push(line);
  }
  return { source, rest: kept.join("\n").trim() };
}

await runMigration({
  description: "Convert *.recipe.card XML body → frontmatter + Markdoc body.",
  match: (name) => name.endsWith(".recipe.card"),
  convert: async (absPath, { warnings, apply }) => {
    const content = await readFile(absPath, "utf-8");
    const split = splitCardContent(content);
    const isXml = /(^|\n)content-type:\s*application\/x-card\+xml/.test(split.frontmatterText);
    if (split.hasFrontmatter && !isXml) return "already";

    const root = await parseCard(content, { source: absPath });
    if (root.tagName !== "recipe") {
      throw new Error(`expected <recipe> root, got <${root.tagName}>`);
    }
    checkElement({ node: root, source: absPath, spec: SPEC, warnings });

    const titleEl = child(root, "title");
    if (titleEl === undefined || text(titleEl) === "") {
      throw new Error("recipe is missing <title>");
    }
    const fields: Record<string, unknown> = { title: text(titleEl) };

    const descEl = child(root, "description");
    if (descEl && text(descEl) !== "") fields.description = text(descEl);
    const sourceEl = child(root, "source");
    if (sourceEl && text(sourceEl) !== "") fields.source = text(sourceEl);

    const bodyParts: string[] = [];

    const yieldEl = child(root, "yield");
    if (yieldEl) {
      bodyParts.push(`{% yield${attrPart(yieldEl, "amount")} %}${text(yieldEl)}{% /yield %}`, "");
    }

    for (const section of root.children) {
      if (section.tagName === "section") bodyParts.push(sectionBody(section));
    }

    const notesEl = child(root, "notes");
    if (notesEl && text(notesEl) !== "") {
      const { source, rest } = splitNotes(text(notesEl));
      if (source !== undefined && fields.source === undefined) fields.source = source;
      if (rest !== "") bodyParts.push("## Notes", "", rest, "");
    }

    const body = bodyParts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    const out = `---\n${stringifyYaml(fields)}---\n${body}\n`;
    if (apply) await writeFile(absPath, out, "utf-8");
    return "converted";
  },
});
