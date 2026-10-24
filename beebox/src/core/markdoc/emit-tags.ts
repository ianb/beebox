/**
 * Per-tag markdown emitters for the backend Markdoc → markdown emitter.
 *
 * Each tag emits a `**Label:** …` form compatible with the shape the old
 * structured `compileBriefing` produced, so existing agent expectations are
 * preserved. Unknown tags emit their inner content with a stderr warning —
 * the documented default: don't lose content silently.
 *
 * Split out of `markdoc/emit.ts` to keep that file under the line cap and to
 * isolate the (large, vocabulary-specific) tag switch from the core node
 * walker. To avoid a value-import cycle with the walker, the children-emitting
 * callback is passed in rather than imported.
 *
 * `todo`/`see-also` (`docs/implemented-plans/todo-annotation.md`) join the universal
 * group alongside `quote`/`source`: a `todo` emits its text behind a
 * compact checklist-style status marker (☐ open / ✔ done / ✘ dropped /
 * ⏸ parked, with `done`/`dropped` also struck) rather than dropping the
 * status metadata; a `see-also` emits its text plus a `[→ ref]`-style
 * citation, the same bracketed shape `source` already uses.
 */

import type { Node } from "@markdoc/markdoc";
import { stringOrNull } from "../../shared/optional-string.js";

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
 *   `Voice_2026-03-15.doc.card`    → "Voice 2026-03-15"
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
  return stringOrNull(attrs[key]) ?? "";
}

/** Collect a node's children into trimmed text. */
function childText(ctx: TagCtx): string {
  const buf: string[] = [];
  ctx.emitChildren(ctx.node, buf);
  return buf.join("").trim();
}

/**
 * Per-tag markdown emitters. Dispatches to one of two groups
 * (universal, markup); unknown tags fall back to "emit inner
 * content + stderr warning".
 */
export function emitTag(ctx: TagCtx): void {
  if (emitUniversalTag(ctx)) return;
  if (emitMarkupTag(ctx)) return;
  const { node, out } = ctx;
  const tagName = node.tag === undefined ? "(unnamed)" : node.tag;
  console.warn(`markdoc/emit: unknown tag {% ${tagName} %}; emitting inner content only`);
  ctx.emitChildren(node, out);
}

/** Universal tags usable across vocabularies: `quote`, `source`, `todo`, `see-also`. */
function emitUniversalTag(ctx: TagCtx): boolean {
  const { node, out } = ctx;
  const attrs = node.attributes;
  switch (node.tag ?? "") {
    case "todo": {
      // Compact checklist-style marker by status (absence = open); `done`/
      // `dropped` strike the text. Nested content (e.g. a `see-also`) is
      // already rendered by the recursive `emitChildren` call `childText`
      // makes, so it flows into the same line — mirrors `quote`'s
      // buf-then-trim pattern rather than restating a walk here.
      const text = childText(ctx);
      const status = str(attrs, "status");
      const struck = status === "done" || status === "dropped";
      const marker =
        status === "done" ? "✔" : status === "dropped" ? "✘" : status === "parked" ? "⏸" : "☐";
      const rendered = struck ? `~~${text}~~` : text;
      const suffix = status === "parked" ? " (parked)" : status === "dropped" ? " (dropped)" : "";
      const line = `${marker} ${rendered}${suffix}`;
      out.push(node.inline ? line : `${line}\n\n`);
      return true;
    }
    case "see-also": {
      // Footnote-style reference, same bracketed-citation shape as
      // `source`'s `[→ ref]` marker (no inline/block split — `see-also`
      // always transforms to a single `SeeAlso` tag).
      const text = childText(ctx);
      const target = str(attrs, "ref") || str(attrs, "href");
      const cite = target === "" ? "" : ` [→ ${displayFromRef(target)}]`;
      out.push(`${text}${cite}`);
      return true;
    }
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
      // The schema's attribute is `usage` (markdoc-config.ts); `as` is its
      // pre-rename spelling, still read so cards written before the rename
      // keep their citation text in compiled output.
      const usage = str(attrs, "usage") === "" ? str(attrs, "as") : str(attrs, "usage");
      const cite = ref === "" ? "" : ` [→ ${displayFromRef(ref)}${usage === "" ? "" : `: ${usage}`}]`;
      out.push(node.inline ? `${content}${cite}` : `${content}${cite}\n\n`);
      return true;
    }
    default:
      return false;
  }
}

/**
 * Tags the parser itself produces: the GFM task checkbox (`task`), rebuilt raw
 * HTML (`html`) and footnotes.
 * HTML goes back out as HTML (Claude reads it fine); footnotes as GFM
 * `[^n]` syntax.
 */
function emitMarkupTag(ctx: TagCtx): boolean {
  const { node, out } = ctx;
  const attrs = node.attributes;
  switch (node.tag ?? "") {
    case "task": {
      // GFM task checkbox. The Markdoc transform injects this for `[ ]`/`[x]`
      // prefixes inside list items; in markdown the original form is exactly
      // what we want.
      out.push(attrs["done"] === true ? "[x] " : "[ ] ");
      return true;
    }
    case "html": {
      const element = str(attrs, "element");
      const rendered = Object.entries(attrs)
        .filter(([name]) => name !== "element")
        .map(([name, value]) => (value === true ? ` ${name.toLowerCase()}` : ` ${name.toLowerCase()}="${String(value)}"`))
        .join("");
      out.push(`<${element}${rendered}>`);
      if (node.children.length === 0 && (element === "br" || element === "wbr" || element === "hr")) return true;
      if (!node.inline) out.push("\n");
      ctx.emitChildren(node, out);
      out.push(node.inline ? `</${element}>` : `\n</${element}>\n\n`);
      return true;
    }
    case "footnote-ref":
      out.push(`[^${String(attrs["n"])}]`);
      return true;
    case "footnotes":
      ctx.emitChildren(node, out);
      return true;
    case "footnote":
      out.push(`[^${String(attrs["n"])}]: `);
      ctx.emitChildren(node, out);
      return true;
    case "footnote-backref":
      return true;
    default:
      return false;
  }
}
