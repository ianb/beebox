#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Migrate `.landmark.card` files from the XML body format to all-YAML
 * frontmatter.
 *
 * Old (XML):
 *   ---
 *   content-type: application/x-card+xml
 *   ---
 *   <landmark>
 *     <navigation>
 *       <label>Recipes</label>
 *       <symbol>🍳</symbol>
 *       <link ref="Bread.recipe.card">the bread</link>
 *       <expand query="*.recipe.card" order="modified-desc">
 *         <link template-ref="${path}">${title}</link>
 *       </expand>
 *     </navigation>
 *     <destination for="triage">
 *       <rules>…</rules>
 *       <procedure ref="archive-recipe.procedure.card"/>
 *     </destination>
 *   </landmark>
 *
 * New (frontmatter):
 *   ---
 *   navigation:
 *     label: Recipes
 *     symbol: 🍳
 *     links:
 *       - { ref: Bread.recipe.card, label: the bread }
 *     expand:
 *       - { query: "*.recipe.card", order: modified-desc, template-ref: "${path}", template-label: "${title}" }
 *   destinations:
 *     - for: [triage]
 *       rules: "…"
 *       procedure-ref: archive-recipe.procedure.card
 *   ---
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/landmark.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/landmark.ts <boxRoot> --apply
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseCard, splitCardContent, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { runMigration } from "./_harness.js";
import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";

const SPEC: ElementSpec = {
  attrs: [],
  children: {
    navigation: {
      attrs: [],
      children: {
        label: { attrs: [] },
        symbol: { attrs: ["src"] },
        link: { attrs: ["ref", "template-ref"] },
        expand: {
          attrs: ["query", "order"],
          children: { link: { attrs: ["ref", "template-ref"] } },
        },
        "chat-app": { attrs: ["narration", "prose"] },
      },
    },
    destination: {
      attrs: ["for"],
      children: { rules: { attrs: [] }, procedure: { attrs: ["ref"] } },
    },
    "triage-destination": {
      attrs: [],
      children: { rules: { attrs: [] }, procedure: { attrs: ["ref"] } },
    },
  },
};

function text(el: ElementNode): string {
  return typeof el.text === "string" ? el.text.trim() : "";
}

function child(el: ElementNode, tag: string): ElementNode | undefined {
  return el.children.find((c) => c.tagName === tag);
}

function children(el: ElementNode, tag: string): ElementNode[] {
  return el.children.filter((c) => c.tagName === tag);
}

interface LinkObj {
  ref: string;
  label?: string;
}

interface ExpandObj {
  query: string;
  order?: string;
  "template-ref"?: string;
  "template-label"?: string;
}

function convertNavigation(nav: ElementNode, source: string, warnings: WarningCollector): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  const labelEl = child(nav, "label");
  if (labelEl && text(labelEl) !== "") out.label = text(labelEl);

  const symbolEl = child(nav, "symbol");
  if (symbolEl) {
    const src = symbolEl.attrs["src"];
    if (typeof src === "string" && src !== "") out.symbol = { src };
    else if (text(symbolEl) !== "") out.symbol = text(symbolEl);
  }

  const links: LinkObj[] = [];
  for (const linkEl of children(nav, "link")) {
    const ref = linkEl.attrs["ref"];
    if (typeof ref !== "string" || ref === "") {
      warnings.push(source, `<navigation> <link> without ref (template-ref="${String(linkEl.attrs["template-ref"])}") dropped`);
      continue;
    }
    const label = text(linkEl);
    links.push(label === "" ? { ref } : { ref, label });
  }
  if (links.length > 0) out.links = links;

  const expands: ExpandObj[] = [];
  for (const expandEl of children(nav, "expand")) {
    const query = expandEl.attrs["query"];
    if (typeof query !== "string" || query === "") {
      warnings.push(source, "<expand> without query dropped");
      continue;
    }
    const expand: ExpandObj = { query };
    const order = expandEl.attrs["order"];
    if (typeof order === "string" && order !== "" && order !== "alphabetical") expand.order = order;
    const tplLinks = children(expandEl, "link");
    if (tplLinks.length > 1) {
      warnings.push(source, `<expand query="${query}"> has ${String(tplLinks.length)} template links; only the first is kept`);
    }
    const tpl = tplLinks[0];
    if (tpl) {
      const tplRef = tpl.attrs["template-ref"];
      if (typeof tplRef === "string" && tplRef !== "" && tplRef !== "${path}") expand["template-ref"] = tplRef;
      const tplLabel = text(tpl);
      if (tplLabel !== "") expand["template-label"] = tplLabel;
    }
    expands.push(expand);
  }
  if (expands.length > 0) out.expand = expands;

  const chatAppEl = child(nav, "chat-app");
  if (chatAppEl) {
    const chatApp: Record<string, string> = {};
    for (const [k, v] of Object.entries(chatAppEl.attrs)) {
      if (typeof v === "string") chatApp[k] = v;
    }
    if (Object.keys(chatApp).length > 0) out["chat-app"] = chatApp;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function convertDestination(el: ElementNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (el.tagName === "triage-destination") {
    out.for = ["triage"];
  } else {
    const forAttr = el.attrs["for"];
    const kinds = typeof forAttr === "string" ? forAttr.trim().split(/\s+/).filter((t) => t !== "") : [];
    out.for = kinds;
  }
  const rulesEl = child(el, "rules");
  if (rulesEl && text(rulesEl) !== "") out.rules = text(rulesEl);
  const procEl = child(el, "procedure");
  if (procEl) {
    const ref = procEl.attrs["ref"];
    if (typeof ref === "string" && ref !== "") out["procedure-ref"] = ref;
  }
  return out;
}

await runMigration({
  description: "Convert *.landmark.card XML body → all-YAML frontmatter.",
  match: (name) => name.endsWith(".landmark.card"),
  convert: async (absPath, { warnings, apply }) => {
    const content = await readFile(absPath, "utf-8");
    const split = splitCardContent(content);
    const contentType = /(^|\n)content-type:\s*application\/x-card\+xml/.test(split.frontmatterText);
    if (split.hasFrontmatter && !contentType) {
      // Already frontmatter (no XML content-type marker).
      return "already";
    }

    const root = await parseCard(content, { source: absPath });
    if (root.tagName !== "landmark") {
      throw new Error(`expected <landmark> root, got <${root.tagName}>`);
    }
    checkElement({ node: root, source: absPath, spec: SPEC, warnings });

    const fields: Record<string, unknown> = {};
    const navEl = child(root, "navigation");
    if (navEl) {
      const navigation = convertNavigation(navEl, absPath, warnings);
      if (navigation) fields.navigation = navigation;
    }
    const destinations: Record<string, unknown>[] = [];
    for (const el of root.children) {
      if (el.tagName === "destination" || el.tagName === "triage-destination") {
        destinations.push(convertDestination(el));
      }
    }
    if (destinations.length > 0) fields.destinations = destinations;

    const out = `---\n${stringifyYaml(fields)}---\n`;
    if (apply) await writeFile(absPath, out, "utf-8");
    return "converted";
  },
});
