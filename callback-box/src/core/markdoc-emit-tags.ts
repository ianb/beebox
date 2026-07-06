/**
 * Per-tag markdown emitters for the backend Markdoc → markdown emitter.
 *
 * Each tag emits a `**Label:** …` form compatible with the shape the old
 * structured `compileBriefing` produced, so existing agent expectations are
 * preserved. Unknown tags emit their inner content with a stderr warning —
 * the documented default: don't lose content silently.
 *
 * Split out of `markdoc-emit.ts` to keep that file under the line cap and to
 * isolate the (large, vocabulary-specific) tag switch from the core node
 * walker. To avoid a value-import cycle with the walker, the children-emitting
 * callback is passed in rather than imported.
 */

import type { Node } from "@markdoc/markdoc";

/** Recursively emit a node's children — supplied by the core walker. */
export type EmitChildren = (node: Node, out: string[]) => void;

/** Everything a per-tag emitter needs: the node, the output buffer, the walker. */
export interface TagCtx {
  node: Node;
  out: string[];
  emitChildren: EmitChildren;
}

/**
 * Derive a short display name from a card ref. Used for `from=` and
 * `ref=` rendering when no explicit alias is supplied.
 *   `/box/people/dana.person.card` → "dana"
 *   `people/dana`                  → "dana"
 *   `Voice_2026-03-15.memo.card`   → "Voice 2026-03-15"
 */
export function displayFromRef(ref: string): string {
  if (ref === "") return "(missing)";
  const noFrag = ref.split("#")[0] ?? ref;
  const noLead = noFrag.replace(/^\/+/, "");
  const basename = noLead.includes("/")
    ? noLead.slice(noLead.lastIndexOf("/") + 1)
    : noLead;
  const stripped = basename.replace(/\.[^.]+\.card$/, "");
  const humanised = stripped.replace(/[_-]+/g, " ").trim();
  return humanised === "" ? ref : humanised;
}

/** Read a string attribute, defaulting to "". */
function str(attrs: Record<string, unknown>, key: string): string {
  return typeof attrs[key] === "string" ? attrs[key] : "";
}

/** Collect a node's children into trimmed text. */
function childText(ctx: TagCtx): string {
  const buf: string[] = [];
  ctx.emitChildren(ctx.node, buf);
  return buf.join("").trim();
}

/**
 * Per-tag markdown emitters. Dispatches to one of three vocabulary groups
 * (universal, briefing, recipe); unknown tags fall back to "emit inner
 * content + stderr warning".
 */
export function emitTag(ctx: TagCtx): void {
  if (emitUniversalTag(ctx)) return;
  if (emitBriefingTag(ctx)) return;
  if (emitRecipeTag(ctx)) return;
  const { node, out } = ctx;
  const tagName = node.tag === undefined ? "(unnamed)" : node.tag;
  console.warn(`markdoc-emit: unknown tag {% ${tagName} %}; emitting inner content only`);
  ctx.emitChildren(node, out);
}

/** Universal tags usable across vocabularies: `quote`, `source`. */
function emitUniversalTag(ctx: TagCtx): boolean {
  const { node, out } = ctx;
  const attrs = node.attributes;
  switch (node.tag ?? "") {
    case "quote": {
      // Markdown blockquote. If a `from` attribute is present, append
      // attribution.
      const buf: string[] = [];
      ctx.emitChildren(node, buf);
      const text = buf.join("").trimEnd();
      const from = str(attrs, "from");
      for (const line of text.split("\n")) {
        out.push(line === "" ? ">\n" : `> ${line}\n`);
      }
      if (from !== "") out.push(`> — ${displayFromRef(from)}\n`);
      out.push("\n");
      return true;
    }
    case "source": {
      // Inline-or-block; emit content followed by a `[→ ref]` citation
      // marker. Markdown can't capture the chip UI; the bracketed form is
      // the closest representation.
      const content = childText(ctx);
      const ref = str(attrs, "ref");
      const as = str(attrs, "as");
      const cite = ref === "" ? "" : ` [→ ${displayFromRef(ref)}${as === "" ? "" : `: ${as}`}]`;
      out.push(node.inline ? `${content}${cite}` : `${content}${cite}\n\n`);
      return true;
    }
    default:
      return false;
  }
}

/**
 * Briefing-vocabulary body tags: `purpose`, `correction`. The structured
 * records (`key-person` → `key-people:`, `property` → `properties:`) moved
 * to briefing frontmatter and are emitted by `compileBriefing`, not here;
 * `project-phase` was retired.
 */
function emitBriefingTag(ctx: TagCtx): boolean {
  const { node, out } = ctx;
  const attrs = node.attributes;
  switch (node.tag ?? "") {
    case "purpose":
      out.push(`**Purpose:** ${childText(ctx)}\n\n`);
      return true;
    case "correction": {
      const test = str(attrs, "test");
      const text = childText(ctx);
      const testStr = test === "" ? "" : ` _(test: ${test})_`;
      out.push(`**Correction:** ${text}${testStr}\n\n`);
      return true;
    }
    default:
      return false;
  }
}

/** Recipe-vocabulary tags: task, ingredient, step, yield, substitution, subrecipe, recipe-section. */
function emitRecipeTag(ctx: TagCtx): boolean {
  const { node, out } = ctx;
  const attrs = node.attributes;
  switch (node.tag ?? "") {
    case "task": {
      // GFM task checkbox. The Markdoc transform injects this for `[ ]`/`[x]`
      // prefixes inside list items; in markdown the original form is exactly
      // what we want.
      const done = attrs["done"] === true;
      out.push(done ? "[x] " : "[ ] ");
      return true;
    }
    case "ingredient": {
      const amount = str(attrs, "amount");
      const unit = str(attrs, "unit");
      const name = childText(ctx);
      const qty = amount === "" ? "" : `${amount}${unit === "" ? "" : ` ${unit}`} `;
      out.push(node.inline ? `**${qty}${name}**` : `- ${qty}${name}\n`);
      return true;
    }
    case "step":
      out.push(`${childText(ctx)}\n\n`);
      return true;
    case "yield": {
      const amount = str(attrs, "amount");
      const text = childText(ctx);
      const base = amount === "" ? "" : ` _(base ${amount})_`;
      out.push(`**Yield:** ${text}${base}\n\n`);
      return true;
    }
    case "substitution": {
      const forAttr = str(attrs, "for");
      const text = childText(ctx);
      const forStr = forAttr === "" ? "" : ` _(for ${forAttr})_`;
      out.push(`**Substitution${forStr}:** ${text}\n\n`);
      return true;
    }
    case "subrecipe": {
      const ref = str(attrs, "ref");
      const text = childText(ctx);
      out.push(`**Subrecipe:** [→ ${ref}]${text === "" ? "" : ` — ${text}`}\n\n`);
      return true;
    }
    case "recipe-section": {
      const name = str(attrs, "name");
      if (name !== "") out.push(`## ${name}\n\n`);
      ctx.emitChildren(node, out);
      return true;
    }
    default:
      return false;
  }
}
