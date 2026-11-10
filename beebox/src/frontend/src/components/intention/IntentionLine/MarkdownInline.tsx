/**
 * One line of Markdown rendered as inline content only: emphasis, strike,
 * code, and links (a bare URL links too). Anything block-shaped or embedded
 * shows as the text that was written, so a line can never grow into a
 * heading, a list, an image, a video, or a custom tag's widget.
 *
 * `Markdown prose="inline"` is not enough for this: it only wraps the output
 * in a span, and a paragraph still renders as a block (`Para`) and an image
 * as a figure or an embed (`Markdown/body.tsx`). Here a single paragraph renders its
 * inline children directly from the parsed nodes, an image in it shows as
 * `![alt](src)`, and any other shape (a heading, a list, a quote, a tag, more
 * than one block) shows the whole source as plain text. Markdoc's inline nodes
 * carry no column positions, so an image is the one node rebuilt from its
 * attributes; a tag cannot be rebuilt faithfully, so it makes the whole line
 * literal.
 */

import { useMemo, type ReactNode } from "react";
import type { Node } from "@markdoc/markdoc";
import { Link } from "../../markdown-link/link";
import { parseMarkdown } from "../../../lib/markdoc-parse";
import { MarkdownRenderContext, type MarkdownRender } from "../../../lib/markdown-render";
import { useBoxSlug } from "../../../lib/box-slug";
import { useOptionalLightbox } from "../../LightboxProvider";
import type { NavigateHint, ViewTarget } from "../../../lib/view-url";

/** An inline line as rendered: plain text, or one element of a rendered paragraph. */
export type InlinePiece =
  | { kind: "text"; text: string }
  | { kind: "strong" | "em" | "s"; children: InlinePiece[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; title: string | undefined; children: InlinePiece[] };

function stringAttr(node: Node, name: string): string | undefined {
  const value: unknown = node.attributes[name];
  return typeof value === "string" ? value : undefined;
}

/** The node as a piece, or null when it is not inline-only (an image, a tag, a nested block). */
function inlinePiece(node: Node): InlinePiece | null {
  const children = (): InlinePiece[] | null => {
    const pieces = node.children.map(inlinePiece);
    return pieces.every((piece) => piece !== null) ? pieces : null;
  };
  const { type } = node;
  if (type === "text") return { kind: "text", text: stringAttr(node, "content") ?? "" };
  if (type === "softbreak" || type === "hardbreak") return { kind: "text", text: " " };
  if (type === "code") return { kind: "code", text: stringAttr(node, "content") ?? "" };
  if (type === "strong" || type === "em" || type === "s") {
    const inner = children();
    return inner === null ? null : { kind: type, children: inner };
  }
  if (type === "link") {
    const inner = children();
    return inner === null ? null : { kind: "link", href: stringAttr(node, "href") ?? "", title: stringAttr(node, "title"), children: inner };
  }
  return null;
}

/** The source as an image node was written, from its attributes. */
function imageSource(node: Node): string {
  return `![${stringAttr(node, "alt") ?? ""}](${stringAttr(node, "src") ?? ""})`;
}

/**
 * The pieces of `source`: a single paragraph's inline children, with an image
 * as its written text, or else the whole source as one text piece.
 */
export function inlineOnlyPieces(source: string): InlinePiece[] {
  const literal: InlinePiece[] = [{ kind: "text", text: source }];
  const blocks = parseMarkdown(source).children;
  const inline = blocks.length === 1 && blocks[0]?.type === "paragraph" ? blocks[0].children[0] : undefined;
  if (inline?.type !== "inline") return literal;
  const pieces = inline.children.map((child) => (child.type === "image" ? { kind: "text" as const, text: imageSource(child) } : inlinePiece(child)));
  return pieces.every((piece) => piece !== null) ? pieces : literal;
}

function renderPieces(pieces: InlinePiece[]): ReactNode[] {
  return pieces.map((piece, index) => {
    switch (piece.kind) {
      case "text": return piece.text;
      case "code": return <code key={index}>{piece.text}</code>;
      case "strong": return <strong key={index}>{renderPieces(piece.children)}</strong>;
      case "em": return <em key={index}>{renderPieces(piece.children)}</em>;
      case "s": return <s key={index}>{renderPieces(piece.children)}</s>;
      case "link": return <Link key={index} href={piece.href} {...(piece.title === undefined ? {} : { title: piece.title })}>{renderPieces(piece.children)}</Link>;
    }
  });
}

export function MarkdownInline({ children, onNavigate, basePath }: {
  children: string;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  /** The document the line belongs to; relative links resolve against it. */
  basePath: string;
}) {
  const boxSlug = useBoxSlug();
  const openImageLink = useOptionalLightbox()?.openFromElement;
  const pieces = useMemo(() => inlineOnlyPieces(children), [children]);
  const render = useMemo<MarkdownRender>(
    () => ({ onNavigate, basePath, boxSlug, onJumpToQuote: undefined, openImageLink, cardPath: null }),
    [onNavigate, basePath, boxSlug, openImageLink],
  );
  return (
    <span className="prose prose-sm inline max-w-none bbx-theme-prose">
      <MarkdownRenderContext.Provider value={render}>
        {renderPieces(pieces)}
      </MarkdownRenderContext.Provider>
    </span>
  );
}
