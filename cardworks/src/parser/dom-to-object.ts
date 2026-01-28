import type { ElementNode, Location, Comments, MixedContent } from "./provenance.js";

/**
 * Line tracking for location calculation.
 */
interface LineTracker {
  lines: string[];
  source: string;
}

/**
 * Create a line tracker from XML content.
 */
export function createLineTracker(xml: string, source: string): LineTracker {
  return {
    lines: xml.split("\n"),
    source,
  };
}

/**
 * Dedent text content by removing common leading whitespace.
 */
export function dedent(text: string): string {
  const lines = text.split("\n");

  // Filter out empty lines for calculating indent
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  if (nonEmptyLines.length === 0) {
    return "";
  }

  // Find minimum indent
  let minIndent = Infinity;
  for (const line of nonEmptyLines) {
    const match = /^(\s*)/.exec(line);
    if (match?.[1] !== undefined) {
      minIndent = Math.min(minIndent, match[1].length);
    }
  }

  if (minIndent === Infinity || minIndent === 0) {
    // No common indent, just trim the result
    return lines
      .map((line) => line.trimEnd())
      .join("\n")
      .trim();
  }

  // Remove common indent from all lines
  return lines
    .map((line) => {
      if (line.trim().length === 0) {
        return "";
      }
      return line.slice(minIndent).trimEnd();
    })
    .join("\n")
    .trim();
}

/**
 * Extract location from a DOM node using its position in the source.
 */
function getNodeLocation(
  node: Node,
  tracker: LineTracker,
  _xml: string
): Location {
  // xmldom provides lineNumber and columnNumber on nodes
  const nodeWithPos = node as Node & {
    lineNumber?: number;
    columnNumber?: number;
  };

  const startLine = nodeWithPos.lineNumber ?? 1;
  const startColumn = nodeWithPos.columnNumber ?? 1;

  return {
    source: tracker.source,
    startLine,
    startColumn,
    endLine: startLine, // Approximate - xmldom doesn't give end position
    endColumn: startColumn,
  };
}

/**
 * Check if a node is an Element.
 */
function isElement(node: Node): node is Element {
  return node.nodeType === 1; // ELEMENT_NODE
}

/**
 * Check if a node is a Text node.
 */
function isText(node: Node): node is Text {
  return node.nodeType === 3; // TEXT_NODE
}

/**
 * Check if a node is a Comment node.
 */
function isComment(node: Node): node is Comment {
  return node.nodeType === 8; // COMMENT_NODE
}

/**
 * Transform a DOM element to an ElementNode.
 */
export function domToObject(
  element: Element,
  tracker: LineTracker,
  xml: string,
  precedingComment?: string
): ElementNode {
  const tagName = element.tagName;
  const attrs: Record<string, string> = {};

  // Extract attributes
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes.item(i);
    if (attr) {
      attrs[attr.name] = attr.value;
    }
  }

  const comments: Comments = {};
  if (precedingComment !== undefined) {
    comments.start = precedingComment;
  }

  const children: ElementNode[] = [];
  const mixedContent: MixedContent[] = [];
  let pendingComment: string | undefined;
  let hasNonWhitespaceText = false;
  let hasComments = false;

  // Process child nodes
  const childNodes = element.childNodes;
  for (let i = 0; i < childNodes.length; i++) {
    const child = childNodes.item(i);
    // childNodes.item can return null in the DOM spec
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (child === null) continue;

    if (isComment(child)) {
      // textContent can be null in DOM spec
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const commentText = dedent(child.textContent ?? "");
      hasComments = true;

      // Add to mixed content
      mixedContent.push({ comment: commentText });

      // Also track for structured comments on adjacent elements
      if (children.length === 0 && !hasNonWhitespaceText) {
        // This is a leading comment for the first child
        pendingComment = commentText;
      } else {
        // Assign to previous element as end comment
        const lastChild = children[children.length - 1];
        if (lastChild) {
          lastChild.comments.end = commentText;
        }
        pendingComment = commentText;
      }
    } else if (isElement(child)) {
      const childNode = domToObject(child, tracker, xml, pendingComment);
      childNode.location = getNodeLocation(child, tracker, xml);
      children.push(childNode);
      mixedContent.push(childNode);
      pendingComment = undefined;
    } else if (isText(child)) {
      // textContent can be null in DOM spec
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const text = child.textContent ?? "";
      // Track if there's any non-whitespace text
      if (text.trim().length > 0) {
        hasNonWhitespaceText = true;
      }
      // Add all text to mixed content (raw, no trimming)
      mixedContent.push(text);
    }
  }

  // Build the result
  const result: ElementNode = {
    tagName,
    attrs,
    comments,
    children,
    location: getNodeLocation(element, tracker, xml),
    dirty: false,
  };

  // Handle text content
  if (hasNonWhitespaceText && children.length === 0 && !hasComments) {
    // Simple text content - dedent it
    const allText = mixedContent.filter((item): item is string => typeof item === "string").join("");
    result.text = dedent(allText);
  } else if (hasNonWhitespaceText || hasComments) {
    // Mixed content - keep raw interleaved text, elements, and comments
    result.mixed = mixedContent;
  }

  return result;
}
