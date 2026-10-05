/**
 * The inline half of the raw-HTML rewrite (see `html-tokens.ts`): the
 * children of one `inline` token, where markdown-it gives one `html_inline`
 * token per tag.
 */

import type Token from "markdown-it/lib/token.js";
import { filterHtmlAttributes, htmlElementRule } from "../html-policy.js";
import { attribute, droppedAttributes, droppedMessage, lexHtml, warning, type HtmlPiece, type OpenPiece } from "./html-lex.js";
import { TokenFactory, literalize, type MarkdocToken, type OpenElement } from "./html-token-factory.js";
import { assertNever } from "../../invariant.js";

/** A `width` an `<img>` may keep: pixels or a percentage. */
const IMAGE_WIDTH = /^\d{1,4}%?$/;

interface InlineState {
  out: Token[];
  stack: OpenElement[];
  depth: number;
  closeAt: (index: number) => void;
  inLink: boolean;
  onLink: (delta: number) => void;
}

export class InlineRewriter extends TokenFactory {
  /** Rewrite the children of one `inline` token. */
  inline(children: Token[]): Token[] {
    const out: Token[] = [];
    const stack: OpenElement[] = [];
    let depth = 0;
    let linkDepth = 0;
    // An inline open tag with no close tag in its container stays literal
    // text: `<var>` or `<b>` in prose is far more often a placeholder than
    // markup meant to run to the end of the paragraph.
    const abandonFrom = (index: number): void => {
      for (const e of stack.splice(index)) {
        if (e.name === "a") linkDepth--;
        if (e.open !== undefined) literalize(e.open.token, e.open.src);
      }
    };
    const closeAt = (index: number): void => {
      const e = stack[index];
      if (e === undefined) return;
      abandonFrom(index + 1);
      stack.pop();
      if (e.name === "a") linkDepth--;
      out.push(e.close());
    };
    const firstAtDepth = (d: number): number => {
      const i = stack.findIndex((e) => e.depth >= d);
      return i === -1 ? stack.length : i;
    };

    for (const tok of children) {
      if (tok.type !== "html_inline") {
        if (tok.nesting === -1) {
          abandonFrom(firstAtDepth(depth));
          depth--;
        }
        if (tok.type === "link_open") linkDepth++;
        if (tok.type === "link_close") linkDepth--;
        out.push(tok);
        if (tok.nesting === 1) depth++;
        continue;
      }
      for (const piece of lexHtml(tok.content, this.md.utils.unescapeAll)) {
        this.inlinePiece(piece, {
          out,
          stack,
          depth,
          closeAt,
          inLink: linkDepth > 0,
          onLink: (delta) => {
            linkDepth += delta;
          },
        });
      }
    }
    abandonFrom(0);
    return out;
  }

  private inlinePiece(piece: HtmlPiece, s: InlineState): void {
    switch (piece.kind) {
      case "comment":
        return;
      case "text":
        s.out.push(this.literal(piece.src));
        return;
      case "other":
        s.out.push(this.literal(piece.src));
        return;
      case "close":
        this.inlineClose(piece, s);
        return;
      case "open":
        if (piece.name === "a") this.openLink(piece, s);
        else if (piece.name === "img") this.image(piece, s);
        else this.openInlineElement(piece, s);
        return;
      default:
        assertNever(piece);
    }
  }

  private inlineClose(piece: HtmlPiece & { kind: "close" }, s: InlineState): void {
    const i = s.stack.findLastIndex((e) => e.name === piece.name && e.depth === s.depth);
    if (i === -1) {
      // Unlisted and block-level elements warn (if at all) at their open tag.
      const supported = piece.name === "a" || htmlElementRule(piece.name)?.level === "inline";
      s.out.push(
        supported ? this.literal(piece.src, `${piece.src} has no matching open tag in this paragraph; shown as text`) : this.literal(piece.src),
      );
      return;
    }
    s.closeAt(i);
  }

  private openLink(piece: OpenPiece, s: InlineState): void {
    const href = this.url(attribute(piece, "href"));
    if (href === null || s.inLink || piece.selfClosing) {
      s.out.push(this.literal(piece.src, "<a> needs a valid href and cannot nest inside another link; shown as text"));
      return;
    }
    const open: MarkdocToken = this.token("link_open", { nesting: 1 });
    open.attrs = [["href", href]];
    const title = attribute(piece, "title");
    if (typeof title === "string") open.attrs.push(["title", title]);
    const dropWarning = droppedMessage("a", droppedAttributes(piece, ["href", "title"]));
    if (dropWarning !== undefined) open.errors = [warning(dropWarning)];
    s.out.push(open);
    s.onLink(1);
    s.stack.push({ name: "a", depth: s.depth, close: () => this.token("link_close", { nesting: -1 }), open: { token: open, src: piece.src } });
  }

  private image(piece: OpenPiece, s: InlineState): void {
    const src = this.url(attribute(piece, "src"));
    if (src === null) {
      s.out.push(this.literal(piece.src, "<img> needs a valid src; shown as text"));
      return;
    }
    const image: MarkdocToken = this.token("image", { nesting: 0 });
    image.attrs = [["src", src]];
    const title = attribute(piece, "title");
    if (typeof title === "string") image.attrs.push(["title", title]);
    const alt = attribute(piece, "alt");
    image.content = typeof alt === "string" ? alt : "";
    image.children = [];
    // Markdoc copies `meta.attributes` of an image token onto the node (its annotation path).
    const width = attribute(piece, "width");
    if (typeof width === "string" && IMAGE_WIDTH.test(width)) {
      image.meta = { attributes: [{ type: "attribute", name: "width", value: width }] };
    }
    const dropWarning = droppedMessage("img", droppedAttributes(piece, ["src", "alt", "title", ...(image.meta === null ? [] : ["width"])]));
    if (dropWarning !== undefined) image.errors = [warning(dropWarning)];
    s.out.push(image);
  }

  private openInlineElement(piece: OpenPiece, s: InlineState): void {
    const rule = htmlElementRule(piece.name);
    if (rule?.level !== "inline") {
      s.out.push(
        this.literal(
          piece.src,
          // An unlisted tag gets no warning: `<name>`-style placeholders in prose are common and render as before.
          rule === undefined ? undefined : `<${piece.name}> must start its own block (a line by itself, after a blank line); shown as text`,
        ),
      );
      return;
    }
    const { kept, dropped } = filterHtmlAttributes(piece.name, piece.attributes);
    const dropWarning = droppedMessage(piece.name, dropped);
    const isVoid = rule.void === true || piece.selfClosing;
    const open: MarkdocToken = this.htmlTag(piece.name, { nesting: isVoid ? 0 : 1, attributes: kept, map: null });
    if (dropWarning !== undefined) open.errors = [warning(dropWarning)];
    s.out.push(open);
    if (isVoid) return;
    s.stack.push({
      name: piece.name,
      depth: s.depth,
      close: () => this.htmlTag(piece.name, { nesting: -1, attributes: {}, map: null }),
      open: { token: open, src: piece.src },
    });
  }
}
