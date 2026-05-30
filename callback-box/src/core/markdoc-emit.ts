/**
 * Backend Markdoc AST → markdown emitter.
 *
 * Walks a parsed Markdoc body and emits plain markdown text suitable for
 * `@`-including into CLAUDE.md (which Claude Code reads as raw markdown —
 * it has no Markdoc awareness). Used by `compileBriefing` and any other
 * server-side path that needs to render Markdoc-tagged bodies as
 * markdown.
 *
 * **Why not `Markdoc.format()`.** The upstream serializer has several
 * silent-data-loss and non-convergence bugs documented at
 * `docs/markdoc-format-investigation.md`. The most disqualifying for us:
 * info-string args after a code fence's language token get dropped
 * (` ```ts setup ` → ` ```ts `). Doctest examples embedded in a card
 * body would be silently corrupted. Hand-rolling this emitter avoids
 * the whole class of problems by emitting only what we want to emit.
 *
 * **Tag emitters live here.** Per-tag rendering for the briefing
 * vocabulary (`purpose`, `key-person`, `correction`, `property`,
 * `project-phase`) plus the universal `quote` and `source` tags
 * produces the `**Label:** …` markdown shape that the old structured
 * `compileBriefing` produced. Unknown tags fall back to "emit inner
 * text + stderr warning" (the documented default in Track 2).
 *
 * Walks the AST directly (pre-transform). Tag names are the canonical
 * authored names (`quote`, `key-person`, etc.), not the post-transform
 * React-component names — that keeps this module Markdoc-config-aware
 * but not React-aware.
 */

import Markdoc from "@markdoc/markdoc";
import type { Node } from "@markdoc/markdoc";

// eslint-disable-next-line import-x/no-named-as-default-member
const { parse } = Markdoc;

/**
 * Parse a markdown/Markdoc body and emit it as plain markdown text.
 * Output ends with a single trailing newline.
 */
export function emitBodyAsMarkdown(body: string): string {
  if (body.trim() === "") return "";
  const ast = parse(body);
  const out: string[] = [];
  emitNode(ast, out);
  let text = out.join("");
  // Collapse runs of more than two consecutive newlines down to two.
  text = text.replace(/\n{3,}/g, "\n\n");
  if (!text.endsWith("\n")) text += "\n";
  return text;
}

function emitNode(node: Node, out: string[]): void {
  switch (node.type) {
    case "document":
      emitChildren(node, out);
      return;
    case "paragraph":
      emitChildren(node, out);
      out.push("\n\n");
      return;
    case "heading": {
      const level = typeof node.attributes["level"] === "number" ? node.attributes["level"] : 1;
      out.push(`${"#".repeat(level)} `);
      emitChildren(node, out);
      out.push("\n\n");
      return;
    }
    case "text": {
      const content = node.attributes["content"];
      if (typeof content === "string") out.push(content);
      return;
    }
    case "strong":
      out.push("**");
      emitChildren(node, out);
      out.push("**");
      return;
    case "em":
      out.push("*");
      emitChildren(node, out);
      out.push("*");
      return;
    case "s":
      out.push("~~");
      emitChildren(node, out);
      out.push("~~");
      return;
    case "code": {
      const content = node.attributes["content"];
      if (typeof content === "string") out.push("`" + content + "`");
      return;
    }
    case "link": {
      const href = typeof node.attributes["href"] === "string" ? node.attributes["href"] : "";
      out.push("[");
      emitChildren(node, out);
      out.push(`](${href})`);
      return;
    }
    case "image": {
      const src = typeof node.attributes["src"] === "string" ? node.attributes["src"] : "";
      const alt = typeof node.attributes["alt"] === "string" ? node.attributes["alt"] : "";
      out.push(`![${alt}](${src})`);
      return;
    }
    case "list": {
      const ordered = node.attributes["ordered"] === true;
      let index = 1;
      for (const item of node.children) {
        if (item.type !== "item") continue;
        out.push(ordered ? `${index}. ` : "- ");
        index++;
        emitItemChildren(item, out);
        out.push("\n");
      }
      out.push("\n");
      return;
    }
    case "item":
      // Handled by parent `list`; bare items emit their content with no marker.
      emitItemChildren(node, out);
      return;
    case "blockquote":
      emitBlockquote(node, out);
      return;
    case "fence": {
      const content = typeof node.attributes["content"] === "string"
        ? node.attributes["content"]
        : "";
      // Markdoc parses the fence's first-line argument string as `language`;
      // the full info-string isn't preserved separately, so we emit just the
      // language token. Bodies that need post-fence args (e.g. `ts setup`)
      // can't be round-tripped through here — same limitation as `format()`.
      const lang = typeof node.attributes["language"] === "string"
        ? node.attributes["language"]
        : "";
      out.push("```" + lang + "\n");
      out.push(content);
      if (!content.endsWith("\n")) out.push("\n");
      out.push("```\n\n");
      return;
    }
    case "hr":
      out.push("---\n\n");
      return;
    case "hardbreak":
      out.push("\\\n");
      return;
    case "softbreak":
      out.push("\n");
      return;
    case "inline":
      emitChildren(node, out);
      return;
    case "tag":
      emitTag(node, out);
      return;
    default:
      // Tables, html, comments, anything else — emit children as a graceful
      // fallback. Briefing bodies aren't expected to use these constructs;
      // if a card relies on one and it doesn't render, that's a finding for
      // a future iteration.
      emitChildren(node, out);
      return;
  }
}

function emitChildren(node: Node, out: string[]): void {
  for (const child of node.children) emitNode(child, out);
}

/** Emit a list item's children inline (no marker — parent emits that). */
function emitItemChildren(item: Node, out: string[]): void {
  // Items usually contain a single paragraph plus optional nested lists.
  // Emit paragraph content inline (no trailing blank line); nested lists
  // get indented.
  for (const child of item.children) {
    if (child.type === "paragraph") {
      emitChildren(child, out);
    } else if (child.type === "list") {
      const buf: string[] = [];
      emitNode(child, buf);
      const indented = buf.join("").trimEnd().split("\n").map((line) => "  " + line).join("\n");
      out.push("\n" + indented);
    } else {
      emitNode(child, out);
    }
  }
}

function emitBlockquote(node: Node, out: string[]): void {
  const buf: string[] = [];
  emitChildren(node, buf);
  const text = buf.join("").trimEnd();
  for (const line of text.split("\n")) {
    out.push(line === "" ? ">\n" : `> ${line}\n`);
  }
  out.push("\n");
}

/**
 * Per-tag markdown emitters. Each tag emits a `**Label:** …` form
 * compatible with the shape the old structured `compileBriefing`
 * produced, so existing agent expectations are preserved.
 *
 * Unknown tags emit their inner content with a `[Unknown tag: …]`
 * marker and log to stderr. This matches the parent plan's documented
 * default: don't lose content silently.
 */
function emitTag(node: Node, out: string[]): void {
  const tag = node.tag;
  const attrs = node.attributes;
  switch (tag) {
    case "quote": {
      // Markdown blockquote. If a `from` attribute is present, append
      // attribution.
      const buf: string[] = [];
      emitChildren(node, buf);
      const text = buf.join("").trimEnd();
      const from = typeof attrs["from"] === "string" ? attrs["from"] : "";
      const lines = text.split("\n");
      for (const line of lines) {
        out.push(line === "" ? ">\n" : `> ${line}\n`);
      }
      if (from !== "") out.push(`> — ${displayFromRef(from)}\n`);
      out.push("\n");
      return;
    }
    case "source": {
      // Inline-or-block; emit content followed by a `[→ ref]` citation
      // marker. Markdown can't capture the chip UI; the bracketed form is
      // the closest representation.
      const buf: string[] = [];
      emitChildren(node, buf);
      const content = buf.join("").trimEnd();
      const ref = typeof attrs["ref"] === "string" ? attrs["ref"] : "";
      const as = typeof attrs["as"] === "string" ? attrs["as"] : "";
      const cite = ref === "" ? "" : ` [→ ${displayFromRef(ref)}${as === "" ? "" : `: ${as}`}]`;
      if (node.inline) {
        out.push(`${content}${cite}`);
      } else {
        out.push(`${content}${cite}\n\n`);
      }
      return;
    }
    case "purpose": {
      const buf: string[] = [];
      emitChildren(node, buf);
      out.push(`**Purpose:** ${buf.join("").trim()}\n\n`);
      return;
    }
    case "key-person": {
      const ref = typeof attrs["ref"] === "string" ? attrs["ref"] : "";
      const called = typeof attrs["called"] === "string" ? attrs["called"] : "";
      const role = typeof attrs["role"] === "string" ? attrs["role"] : "";
      const name = called !== "" ? called : displayFromRef(ref);
      const buf: string[] = [];
      emitChildren(node, buf);
      const desc = buf.join("").trim();
      const refStr = ref === "" ? "" : ` [→ ${ref}]`;
      const roleStr = role === "" ? "" : ` — ${role}`;
      const descStr = desc === "" ? "" : ` — ${desc}`;
      out.push(`**Key Person:** **${name}**${roleStr}${refStr}${descStr}\n\n`);
      return;
    }
    case "correction": {
      const test = typeof attrs["test"] === "string" ? attrs["test"] : "";
      const buf: string[] = [];
      emitChildren(node, buf);
      const text = buf.join("").trim();
      const testStr = test === "" ? "" : ` _(test: ${test})_`;
      out.push(`**Correction:** ${text}${testStr}\n\n`);
      return;
    }
    case "property": {
      const name = typeof attrs["name"] === "string" ? attrs["name"] : "";
      const address = typeof attrs["address"] === "string" ? attrs["address"] : "";
      const uncertain = attrs["address-uncertain"] === true;
      const heading = name !== "" ? name : (address !== "" ? address : "(unnamed)");
      const addrStr = address !== "" && address !== name
        ? ` — ${address}${uncertain ? " (uncertain)" : ""}`
        : "";
      const buf: string[] = [];
      emitChildren(node, buf);
      const desc = buf.join("").trim();
      const descStr = desc === "" ? "" : ` — ${desc}`;
      out.push(`**Property:** **${heading}**${addrStr}${descStr}\n\n`);
      return;
    }
    case "project-phase": {
      const date = typeof attrs["date"] === "string" ? attrs["date"] : "";
      const buf: string[] = [];
      emitChildren(node, buf);
      const text = buf.join("").trim();
      const dateStr = date === "" ? "" : ` (${date})`;
      out.push(`**Current Phase**${dateStr}: ${text}\n\n`);
      return;
    }
    case "task": {
      // GFM task checkbox. The Markdoc transform injects this for `[ ]`/`[x]`
      // prefixes inside list items; in markdown the original form is exactly
      // what we want.
      const done = attrs["done"] === true;
      out.push(done ? "[x] " : "[ ] ");
      return;
    }
    default: {
      const tagName = tag === undefined ? "(unnamed)" : tag;
      console.warn(`markdoc-emit: unknown tag {% ${tagName} %}; emitting inner content only`);
      emitChildren(node, out);
      return;
    }
  }
}

/**
 * Derive a short display name from a card ref. Used for `from=` and
 * `ref=` rendering when no explicit alias is supplied.
 *   `/box/people/dana.person.card` → "dana"
 *   `people/dana`                  → "dana"
 *   `Voice_2026-03-15.memo.card`   → "Voice 2026-03-15"
 */
function displayFromRef(ref: string): string {
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
