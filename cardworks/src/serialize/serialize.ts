import type { ElementNode, MixedContent, MixedComment } from "../parser/provenance.js";

/**
 * Options for XML serialization.
 */
export interface SerializeOptions {
  /** Indentation string (default: "  " - two spaces) */
  indent?: string;
  /** Whether to include XML declaration (default: false) */
  xmlDeclaration?: boolean;
}

/**
 * Escape special XML characters in text content.
 */
function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Escape special XML characters in attribute values.
 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Serialize an ElementNode back to XML string.
 *
 * @param node - The ElementNode to serialize
 * @param options - Serialization options
 * @returns The XML string representation
 */
export function serialize(
  node: ElementNode,
  options: SerializeOptions = {}
): string {
  const indent = options.indent ?? "  ";
  const lines: string[] = [];

  if (options.xmlDeclaration) {
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  }

  serializeNode(node, lines, 0, indent);

  return lines.join("\n");
}

/**
 * Serialize a single node and its children.
 */
function serializeNode(
  node: ElementNode,
  lines: string[],
  depth: number,
  indent: string
): void {
  const padding = indent.repeat(depth);

  // Add comment at start if present
  if (node.comments.start) {
    lines.push(`${padding}<!-- ${node.comments.start.trim()} -->`);
  }

  // Build opening tag
  const attrs = serializeAttrs(node.attrs);
  const tagOpen = attrs ? `<${node.tagName} ${attrs}` : `<${node.tagName}`;

  // Determine content type
  const hasChildren = node.children.length > 0;
  const hasText = node.text !== undefined && node.text.length > 0;
  const hasMixedContent = node.mixed !== undefined && node.mixed.length > 0;

  if (!hasChildren && !hasText && !hasMixedContent) {
    // Self-closing tag
    lines.push(`${padding}${tagOpen}/>`);
  } else if (hasText && !hasChildren) {
    // Simple text content
    const textContent = serializeTextContent(node.text ?? "", depth, indent);
    if (textContent.includes("\n")) {
      // Multiline text
      lines.push(`${padding}${tagOpen}>`);
      lines.push(textContent);
      lines.push(`${padding}</${node.tagName}>`);
    } else {
      // Single line text
      lines.push(`${padding}${tagOpen}>${escapeText(textContent)}</${node.tagName}>`);
    }
  } else if (hasMixedContent) {
    // Mixed content - interleaved text and elements
    const mixedContent = serializeMixedContent(node.mixed ?? []);
    lines.push(`${padding}${tagOpen}>${mixedContent}</${node.tagName}>`);
  } else {
    // Element with children
    lines.push(`${padding}${tagOpen}>`);
    for (const child of node.children) {
      serializeNode(child, lines, depth + 1, indent);
    }
    lines.push(`${padding}</${node.tagName}>`);
  }

  // Add comment at end if present
  if (node.comments.end) {
    lines.push(`${padding}<!-- ${node.comments.end.trim()} -->`);
  }
}

/**
 * Serialize attributes to a string.
 */
function serializeAttrs(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeAttr(value)}"`)
    .join(" ");
}

/**
 * Serialize text content, preserving multiline structure.
 */
function serializeTextContent(
  text: string,
  depth: number,
  indent: string
): string {
  const lines = text.split("\n");

  if (lines.length === 1) {
    return text;
  }

  // Re-indent multiline content
  const padding = indent.repeat(depth + 1);
  return lines.map((line) => `${padding}${escapeText(line)}`).join("\n");
}

/**
 * Check if an item is a MixedComment.
 */
function isMixedComment(item: MixedContent): item is MixedComment {
  return typeof item === "object" && "comment" in item;
}

/**
 * Serialize mixed content (interleaved text, elements, and comments).
 */
function serializeMixedContent(mixed: MixedContent[]): string {
  const parts: string[] = [];

  for (const item of mixed) {
    if (typeof item === "string") {
      // Raw text - escape but don't trim
      parts.push(escapeText(item));
    } else if (isMixedComment(item)) {
      // Comment
      parts.push(`<!-- ${item.comment} -->`);
    } else {
      // Element node - serialize inline
      const attrs = serializeAttrs(item.attrs);
      const tagOpen = attrs ? `<${item.tagName} ${attrs}` : `<${item.tagName}`;

      if (item.text) {
        parts.push(`${tagOpen}>${escapeText(item.text)}</${item.tagName}>`);
      } else if (item.children.length > 0) {
        // Nested children in mixed content - serialize recursively inline
        const childLines: string[] = [];
        for (const child of item.children) {
          serializeNode(child, childLines, 0, "");
        }
        parts.push(`${tagOpen}>${childLines.join("")}</${item.tagName}>`);
      } else {
        parts.push(`${tagOpen}/>`);
      }
    }
  }

  return parts.join("");
}
