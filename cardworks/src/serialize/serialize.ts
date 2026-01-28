import type { ElementNode, TextSegment } from "../parser/provenance.js";

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

  // Add comment before if present
  if (node.comments.before) {
    lines.push(`${padding}<!-- ${node.comments.before.trim()} -->`);
  }

  // Build opening tag
  const attrs = serializeAttrs(node.attrs);
  const tagOpen = attrs ? `<${node.tagName} ${attrs}` : `<${node.tagName}`;

  // Determine content type
  const hasChildren = node.children.length > 0;
  const hasText = node.text !== undefined && node.text.length > 0;
  const hasMixedContent =
    node.textSegments !== undefined && node.textSegments.length > 0;

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
    // Mixed content - text interspersed with elements
    const mixedContent = serializeMixedContent(
      node.textSegments ?? [],
      node.children,
      depth,
      indent
    );
    lines.push(`${padding}${tagOpen}>${mixedContent}</${node.tagName}>`);
  } else {
    // Element with children
    lines.push(`${padding}${tagOpen}>`);
    for (const child of node.children) {
      serializeNode(child, lines, depth + 1, indent);
    }
    lines.push(`${padding}</${node.tagName}>`);
  }

  // Add comment after if present
  if (node.comments.after) {
    lines.push(`${padding}<!-- ${node.comments.after.trim()} -->`);
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
 * Serialize mixed content (text segments interspersed with elements).
 */
function serializeMixedContent(
  textSegments: TextSegment[],
  children: ElementNode[],
  _depth: number,
  _indent: string
): string {
  // Create a combined list of items by position
  const items: Array<{ type: "text" | "element"; content: string; position: number }> =
    [];

  for (const segment of textSegments) {
    items.push({
      type: "text",
      content: escapeText(segment.text),
      position: segment.position,
    });
  }

  // For children in mixed content, we serialize inline
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child) continue;

    // Find the position - it should be between text segments
    const positionIndex = textSegments.findIndex((s) => s.position > i);
    const childPosition = (positionIndex === -1 ? i : positionIndex - 0.5) + i;

    const attrs = serializeAttrs(child.attrs);
    const tagOpen = attrs ? `<${child.tagName} ${attrs}` : `<${child.tagName}`;

    if (child.text) {
      items.push({
        type: "element",
        content: `${tagOpen}>${escapeText(child.text)}</${child.tagName}>`,
        position: childPosition,
      });
    } else {
      items.push({
        type: "element",
        content: `${tagOpen}/>`,
        position: childPosition,
      });
    }
  }

  // Sort by position and join
  items.sort((a, b) => a.position - b.position);

  return items.map((item) => item.content).join("");
}
