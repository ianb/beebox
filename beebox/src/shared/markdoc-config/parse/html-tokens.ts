/**
 * Rebuild raw HTML in a markdown-it token stream as Markdoc nodes.
 *
 * With `html: true`, markdown-it hands us HTML as unparsed fragments: an
 * `html_inline` token per tag (`<sub>` and `</sub>` separately), and an
 * `html_block` token per run of block HTML up to a blank line — so
 * `<details>` and `</details>` may sit in different tokens with Markdown
 * paragraphs between them. Markdoc's parser drops the content of both token
 * types, so this pass runs on tokens, before `Markdoc.parse`:
 *
 *  - An allowed element (`html-policy.ts`) becomes a Markdoc `html` tag
 *    token carrying the element name and its filtered attributes. Opens and
 *    closes are matched within one Markdown container (a paragraph's inline
 *    run, a list item, the document); an element still open when its
 *    container ends is closed there, as a browser would.
 *  - `<a href>` and `<img src>` become Markdown link and image tokens, with
 *    the URL normalized and validated exactly as markdown-it does for
 *    `[text](url)`. A URL that fails validation leaves the tag literal.
 *  - Text between block-level tags is parsed as inline Markdown. (GFM leaves
 *    it raw until the next blank line; rendering it is a deliberate superset.)
 *  - HTML comments disappear.
 *  - Anything else — an unlisted tag, a close tag with no open, a block tag
 *    in the middle of a paragraph — stays literal text, carrying a
 *    validation warning so `bbx validate` can tell the agent.
 *
 * The output contains only tokens Markdoc already understands (`tag_*`,
 * `link_*`, `image`, `text`, `inline`, `paragraph_*`), so nothing raw ever
 * reaches a renderer.
 */

import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.js";
import { filterHtmlAttributes, htmlElementRule } from "../html-policy.js";
import { droppedMessage, lexHtml, warning } from "./html-lex.js";
import { InlineRewriter } from "./html-inline.js";
import type { MarkdocToken, OpenElement } from "./html-token-factory.js";

class BlockRewriter extends InlineRewriter {
  /** Rewrite a block-level token stream. */
  block(tokens: Token[]): Token[] {
    const out: Token[] = [];
    const stack: OpenElement[] = [];
    let depth = 0;
    const closeFrom = (index: number): void => {
      while (stack.length > index) {
        const e = stack.pop();
        if (e === undefined) break;
        out.push(e.close());
      }
    };
    const firstAtDepth = (d: number): number => {
      const i = stack.findIndex((e) => e.depth >= d);
      return i === -1 ? stack.length : i;
    };

    for (const tok of tokens) {
      if (tok.type === "html_block") {
        this.htmlBlock(tok, { out, stack, depth, closeFrom });
        continue;
      }
      if (tok.type === "inline" && tok.children !== null) tok.children = this.inline(tok.children);
      if (tok.nesting === -1) {
        closeFrom(firstAtDepth(depth));
        depth--;
      }
      out.push(tok);
      if (tok.nesting === 1) depth++;
    }
    closeFrom(0);
    return out;
  }

  private htmlBlock(
    tok: Token,
    s: { out: Token[]; stack: OpenElement[]; depth: number; closeFrom: (index: number) => void },
  ): void {
    const map = tok.map;
    let run = "";
    const flush = (): void => {
      const text = run;
      run = "";
      if (text.trim() === "") return;
      const [inlineToken] = this.md.parseInline(text.trim(), {});
      if (inlineToken === undefined) return;
      inlineToken.map = map;
      inlineToken.children = this.inline(inlineToken.children ?? []);
      const top = s.stack.at(-1);
      const insideElement = top !== undefined && top.depth === s.depth;
      if (!insideElement) s.out.push(this.token("paragraph_open", { nesting: 1, map }));
      s.out.push(inlineToken);
      if (!insideElement) s.out.push(this.token("paragraph_close", { nesting: -1, map }));
    };

    for (const piece of lexHtml(tok.content, this.md.utils.unescapeAll)) {
      if (piece.kind === "comment") continue;
      if (piece.kind === "text" || piece.kind === "other") {
        run += piece.src;
        continue;
      }
      const rule = htmlElementRule(piece.name);
      if (rule?.level !== "block") {
        // Inline tags, `a`/`img`, and unsupported tags: the inline pass decides.
        run += piece.src;
        continue;
      }
      if (piece.kind === "close") {
        const i = s.stack.findLastIndex((e) => e.name === piece.name && e.depth === s.depth);
        if (i === -1) {
          run += piece.src;
          continue;
        }
        flush();
        s.closeFrom(i);
        continue;
      }
      flush();
      const closes = rule.closes ?? [];
      for (let top = s.stack.at(-1); top !== undefined && top.depth === s.depth && closes.includes(top.name); top = s.stack.at(-1)) {
        s.closeFrom(s.stack.length - 1);
      }
      // A row directly in a table gets the `<tbody>` a browser's parser would add.
      const top = s.stack.at(-1);
      if (piece.name === "tr" && top?.name === "table" && top.depth === s.depth) {
        s.out.push(this.htmlTag("tbody", { nesting: 1, attributes: {}, map }));
        s.stack.push({ name: "tbody", depth: s.depth, close: () => this.htmlTag("tbody", { nesting: -1, attributes: {}, map }) });
      }
      const { kept, dropped } = filterHtmlAttributes(piece.name, piece.attributes);
      const dropWarning = droppedMessage(piece.name, dropped);
      if (rule.void === true || piece.selfClosing) {
        const t: MarkdocToken = this.htmlTag(piece.name, { nesting: 0, attributes: kept, map });
        if (dropWarning !== undefined) t.errors = [warning(dropWarning)];
        s.out.push(t);
        continue;
      }
      const open: MarkdocToken = this.htmlTag(piece.name, { nesting: 1, attributes: kept, map });
      if (dropWarning !== undefined) open.errors = [warning(dropWarning)];
      s.out.push(open);
      s.stack.push({ name: piece.name, depth: s.depth, close: () => this.htmlTag(piece.name, { nesting: -1, attributes: {}, map }) });
    }
    flush();
  }
}

/**
 * Replace every `html_block` / `html_inline` token in a markdown-it stream
 * (from a tokenizer built with `html: true`) with Markdoc-safe tokens. `md`
 * is the tokenizer's own markdown-it instance, so inline re-parsing and URL
 * normalization match the rest of the document.
 */
export function rewriteHtmlTokens(tokens: Token[], md: MarkdownIt): Token[] {
  return new BlockRewriter(md).block(tokens);
}
