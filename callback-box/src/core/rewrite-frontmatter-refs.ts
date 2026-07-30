/**
 * The frontmatter half of the ref scan (`rewrite-card-refs.ts` owns the body
 * half and the public entry points). It is deliberately line-based rather than
 * a YAML parse: parsing and reserializing a card reorders its frontmatter keys
 * to schema order (see CLAUDE.md), which is an unacceptable diff for a tool
 * whose whole job is a mechanical one-line-per-ref change.
 *
 * Being line-based, it must recognize the YAML constructs where a ref-shaped
 * line is NOT a ref: a block scalar's prose body, and an end-of-line comment.
 * Both are handled here; inline-map forms (`- { ref: x }`) are the documented
 * safe-direction gap — never matched, so never corrupted.
 */

import { invariant } from "../lib/invariant.js";

/** A per-ref transform: given a raw ref token, return it unchanged or rewritten. */
export type RefTransform = (rawRef: string) => string;

/** Quote-aware unwrap of a YAML scalar value. Returns the inner value + quote char. */
function unquote(value: string): { inner: string; quote: string } {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value[value.length - 1] === first) {
      return { inner: value.slice(1, -1), quote: first };
    }
  }
  return { inner: value, quote: "" };
}

/**
 * Where a YAML end-of-line comment starts inside a scalar value, or -1. YAML
 * requires whitespace before a comment `#`, which is exactly what separates it
 * from a ref's own `#fragment` (`Plan.doc.card#risks` — attached, so it
 * survives). Quoted runs are skipped so `ref: "a # b"` is one value, not a
 * value plus a comment.
 */
function commentAt(value: string): number {
  let quote = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote !== "") {
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "#" && i > 0 && /\s/.test(value[i - 1] ?? "")) return i;
  }
  return -1;
}

/**
 * Split a captured scalar value into the ref token and its trailing comment
 * (whitespace gap included, so re-emitting is byte-exact). Without this, `- ref:
 * Sibling.card  # why` captured the comment as part of the token, which never
 * resolved — so mv and the canonical fixer silently skipped the ref and left it
 * dangling after a move.
 */
function splitTrailingComment(value: string): { token: string; comment: string } {
  const at = commentAt(value);
  if (at === -1) return { token: value, comment: "" };
  const token = value.slice(0, at).trimEnd();
  return { token, comment: value.slice(token.length) };
}

/**
 * The indent a YAML block scalar's body must exceed to stay inside it, or -1
 * when the line does not open one. A key whose value position holds only a
 * block-scalar indicator (`|`, `|-`, `>+`, `|2`, …) introduces literal prose:
 * every deeper-indented line below it is text, not YAML, and must not be
 * scanned for refs (a `  - ref: Sibling.card` line inside `notes: |` is prose
 * that the ref regexes would otherwise rewrite — text corruption).
 */
function blockScalarIndent(line: string): number {
  if (!/^\s*(?:-\s+)?[^\s#:][^:]*:\s*[>|][+-]?\d*\s*$/.test(line)) return -1;
  return line.search(/\S/);
}

/**
 * Rewrite refs inside the frontmatter block (between the leading `---` and the
 * next `---`). It rewrites any `ref:` scalar or `refs:` list at *any* nesting,
 * not just at the top level — a card reference is always stored under a key
 * named exactly `ref` (or `refs`), so a nested `procedure:\n  ref: <path>`,
 * `frozen:\n  ref: <path>`, etc. are rewritten the same as a top-level
 * `ref:`. Returns the text with that region rewritten.
 */
export function rewriteFrontmatter(text: string, wrap: RefTransform): string {
  if (!text.startsWith("---\n")) return text;
  const lines = text.split("\n");
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return text;

  const apply = (value: string): string => {
    const { token, comment } = splitTrailingComment(value);
    const { inner, quote } = unquote(token);
    return quote + wrap(inner) + quote + comment;
  };

  let refsIndent = -1; // indentation of an open `refs:` block, or -1
  let blockIndent = -1; // indentation of an open block scalar's key, or -1
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // Inside a block scalar every deeper-indented line is literal prose. A
    // blank line doesn't close the scalar; a line at or left of the key does.
    if (blockIndent !== -1) {
      const at = line.search(/\S/);
      if (at === -1 || at > blockIndent) continue;
      blockIndent = -1;
    }
    const opened = blockScalarIndent(line);
    if (opened !== -1) {
      blockIndent = opened;
      refsIndent = -1;
      continue;
    }

    // `ref:` as a plain key OR as the first key of a block-list item
    // (`  - ref: <path>` — the dominant shape for `messages:`/`items:` lists).
    // Missing the list-item form left `cb mv` silently not rewriting the most
    // common nested ref there is.
    const scalar = /^(\s*(?:-\s+)?ref:\s+)(\S.*?)\s*$/.exec(line);
    if (scalar !== null) {
      const [, prefix, value] = scalar;
      invariant(
        prefix !== undefined && value !== undefined,
        "ref: scalar regex has two mandatory capture groups",
      );
      lines[i] = prefix + apply(value);
      refsIndent = -1;
      continue;
    }

    const inlineList = /^(\s*refs:\s*\[)(.*)(]\s*)$/.exec(line);
    if (inlineList !== null) {
      const [, prefix, itemsRaw, suffix] = inlineList;
      invariant(
        prefix !== undefined && itemsRaw !== undefined && suffix !== undefined,
        "refs: [...] regex has three mandatory capture groups",
      );
      const items = itemsRaw
        .split(",")
        .map((item) => {
          const m = /^(\s*)(\S.*?)(\s*)$/.exec(item);
          if (m === null) return item;
          const [, lead, core, trail] = m;
          invariant(
            lead !== undefined && core !== undefined && trail !== undefined,
            "inline-list item regex has three mandatory capture groups",
          );
          return lead + apply(core) + trail;
        })
        .join(",");
      lines[i] = prefix + items + suffix;
      refsIndent = -1;
      continue;
    }

    const blockOpen = /^(\s*)refs:\s*$/.exec(line);
    if (blockOpen !== null) {
      const [, indent] = blockOpen;
      invariant(indent !== undefined, "refs: block-open regex has one mandatory capture group");
      refsIndent = indent.length;
      continue;
    }

    if (refsIndent !== -1) {
      const item = /^(\s+-\s+)(\S.*?)\s*$/.exec(line);
      if (item !== null && line.search(/\S/) > refsIndent) {
        const [, prefix, value] = item;
        invariant(
          prefix !== undefined && value !== undefined,
          "refs list-item regex has two mandatory capture groups",
        );
        lines[i] = prefix + apply(value);
        continue;
      }
      // A line that isn't a deeper list item closes the refs block.
      if (line.trim() !== "") refsIndent = -1;
    }
  }

  return lines.join("\n");
}
