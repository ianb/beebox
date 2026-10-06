/**
 * Turn markdown-it-footnote's tokens into Markdoc tag tokens.
 *
 * The plugin parses GFM footnotes (`text[^1]` … `[^1]: note`) and appends a
 * footnote block to the token stream. Markdoc's parser keeps no `meta` for
 * token types it does not know, so the footnote numbers would be lost; this
 * pass rewrites each plugin token as a Markdoc tag (`footnote-ref`,
 * `footnotes`, `footnote`, `footnote-backref`, all schemas in `core.ts`)
 * carrying the number as an attribute.
 *
 * The plugin places each back-reference anchor between a definition's last
 * `inline` token and its `paragraph_close`; it moves into that inline's
 * children here, so the paragraph keeps its `inline`-only content model.
 */

import type Token from "markdown-it/lib/token.js";
import { invariant } from "../../invariant.js";

interface FootnoteMeta {
  id: number;
  subId?: number;
}

function footnoteMeta(token: Token): FootnoteMeta {
  const meta: unknown = token.meta;
  invariant(
    typeof meta === "object" && meta !== null && "id" in meta && typeof meta.id === "number",
    `markdown-it-footnote ${token.type} token without a numeric meta.id`,
  );
  const subId = "subId" in meta && typeof meta.subId === "number" ? meta.subId : undefined;
  return subId === undefined ? { id: meta.id } : { id: meta.id, subId };
}

function asTag(token: Token, { tag, attributes }: { tag: string; attributes: Record<string, number> }): Token {
  token.type = token.nesting === 1 ? "tag_open" : token.nesting === -1 ? "tag_close" : "tag";
  token.meta = {
    tag,
    attributes: Object.entries(attributes).map(([name, value]) => ({ type: "attribute", name, value })),
  };
  return token;
}

/** Footnote numbers are 1-based; back-reference ids are 0-based like the plugin's. */
function numbered(token: Token): Record<string, number> {
  const { id, subId } = footnoteMeta(token);
  return subId === undefined || subId === 0 ? { n: id + 1 } : { n: id + 1, sub: subId };
}

function rewriteInline(children: Token[]): Token[] {
  return children.map((t) => (t.type === "footnote_ref" ? asTag(t, { tag: "footnote-ref", attributes: numbered(t) }) : t));
}

/** Rewrite footnote tokens in a block token stream (after the plugin's core rule has run). */
export function rewriteFootnoteTokens(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const token of tokens) {
    if (token.type === "inline" && token.children !== null) {
      token.children = rewriteInline(token.children);
      out.push(token);
      continue;
    }
    switch (token.type) {
      case "footnote_block_open":
      case "footnote_block_close":
        out.push(asTag(token, { tag: "footnotes", attributes: {} }));
        continue;
      case "footnote_open":
        out.push(asTag(token, { tag: "footnote", attributes: numbered(token) }));
        continue;
      case "footnote_close":
        out.push(asTag(token, { tag: "footnote", attributes: {} }));
        continue;
      case "footnote_anchor": {
        const backref = asTag(token, { tag: "footnote-backref", attributes: numbered(token) });
        const previous = out.at(-1);
        if (previous?.type === "inline" && previous.children !== null) previous.children.push(backref);
        else out.push(backref);
        continue;
      }
      default:
        out.push(token);
    }
  }
  return out;
}
