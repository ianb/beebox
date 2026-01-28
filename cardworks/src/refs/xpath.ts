import { DOMParser } from "@xmldom/xmldom";
import * as xpath from "xpath-ts";
import type { ElementNode } from "../parser/provenance.js";

// xmldom's Document type is compatible with xpath-ts at runtime but not at compile time
// We use type assertions to bridge this gap
type XmldomDocument = ReturnType<DOMParser["parseFromString"]>;
type XmldomElement = XmldomDocument["documentElement"];

/**
 * Result of an XPath query.
 */
export interface XPathResult {
  /** Matched ElementNodes (empty if no matches) */
  nodes: ElementNode[];
  /** Error message if query failed */
  error?: string;
  /** Warning message (e.g., multiple matches for query that expects one) */
  warning?: string;
}

/**
 * Execute an XPath query against an ElementNode tree.
 *
 * @param expr - The XPath expression
 * @param root - The root ElementNode to query
 * @param expectOne - If true, warns when multiple results found
 * @returns The query result with matched nodes
 */
export function executeXPath(
  expr: string,
  root: ElementNode,
  expectOne: boolean
): XPathResult {
  // Rebuild DOM from ElementNode
  const doc = elementNodeToDocument(root);

  // Execute XPath query
  // xpath-ts accepts xmldom's Document at runtime, but types don't match
  let xpathResult: unknown[];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const selected = xpath.select(expr, doc as any);
    if (!Array.isArray(selected)) {
      // xpath.select can return a string/number/boolean for certain expressions
      return {
        nodes: [],
        error: `XPath expression "${expr}" did not return nodes`,
      };
    }
    xpathResult = selected as unknown[];
  } catch (e) {
    return {
      nodes: [],
      error: `XPath error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Filter to element nodes only (nodeType 1 = ELEMENT_NODE)
  const elementDomNodes: XmldomElement[] = [];
  for (const node of xpathResult) {
    if (typeof node === "object" && node !== null && "nodeType" in node && node.nodeType === 1) {
      elementDomNodes.push(node as XmldomElement);
    }
  }

  if (elementDomNodes.length === 0) {
    return { nodes: [] };
  }

  // Map DOM nodes back to ElementNodes
  const matchedNodes = mapDomNodesToElementNodes(elementDomNodes, root, doc);

  // Build result
  const queryResult: XPathResult = { nodes: matchedNodes };

  // Check for warnings
  if (expectOne && matchedNodes.length > 1) {
    queryResult.warning = `XPath query "${expr}" matched ${String(matchedNodes.length)} elements, expected 1`;
  }

  return queryResult;
}

/**
 * Convert an ElementNode tree to an XML Document.
 */
function elementNodeToDocument(root: ElementNode): XmldomDocument {
  const xml = serializeElementNode(root);
  const parser = new DOMParser();
  return parser.parseFromString(xml, "text/xml");
}

/**
 * Serialize an ElementNode to XML string.
 */
function serializeElementNode(node: ElementNode): string {
  const parts: string[] = [];

  // Opening tag
  parts.push(`<${node.tagName}`);

  // Attributes
  for (const [name, value] of Object.entries(node.attrs)) {
    const escaped = value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    parts.push(` ${name}="${escaped}"`);
  }

  // Check if self-closing
  const hasContent = node.text || node.children.length > 0 || node.mixed;

  if (!hasContent) {
    parts.push("/>");
    return parts.join("");
  }

  parts.push(">");

  // Content
  if (node.mixed) {
    for (const item of node.mixed) {
      if (typeof item === "string") {
        parts.push(escapeText(item));
      } else if ("comment" in item) {
        parts.push(`<!--${item.comment}-->`);
      } else {
        parts.push(serializeElementNode(item));
      }
    }
  } else {
    if (node.text) {
      parts.push(escapeText(node.text));
    }
    for (const child of node.children) {
      parts.push(serializeElementNode(child));
    }
  }

  // Closing tag
  parts.push(`</${node.tagName}>`);

  return parts.join("");
}

/**
 * Escape text content for XML.
 */
function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Map DOM Element nodes back to their corresponding ElementNodes.
 *
 * This works by computing a path (sequence of child indices) from root to each
 * matched DOM node, then following the same path in the ElementNode tree.
 */
function mapDomNodesToElementNodes(
  domNodes: XmldomElement[],
  root: ElementNode,
  doc: XmldomDocument
): ElementNode[] {
  const results: ElementNode[] = [];
  const docRoot = doc.documentElement;

  if (!docRoot) {
    return results;
  }

  for (const domNode of domNodes) {
    // Compute path from document root to this node
    const path = computePath(domNode, docRoot);
    if (path) {
      // Follow path in ElementNode tree
      const elementNode = followPath(root, path);
      if (elementNode) {
        results.push(elementNode);
      }
    }
  }

  return results;
}

/**
 * Compute the path (child indices) from root to target.
 * Returns null if target is not a descendant of root.
 */
function computePath(target: XmldomElement, root: XmldomElement): number[] | null {
  if (target === root) {
    return [];
  }

  const path: number[] = [];
  let current: XmldomElement | null = target;

  while (current && current !== root) {
    const parent = current.parentNode;
    if (!parent) {
      return null;
    }

    // Find index among element siblings
    let index = 0;
    let sibling = current.previousSibling;
    while (sibling) {
      if (sibling.nodeType === 1) {
        index++;
      }
      sibling = sibling.previousSibling;
    }
    path.unshift(index);

    // Parent could be Document (nodeType 9) or Element (nodeType 1)
    if (parent.nodeType !== 1) {
      // Parent is document node, current should be root
      break;
    }
    current = parent as XmldomElement;
  }

  // Verify we reached root
  if (current !== root) {
    return null;
  }

  return path;
}

/**
 * Follow a path of child indices in an ElementNode tree.
 */
function followPath(root: ElementNode, path: number[]): ElementNode | null {
  let current: ElementNode = root;

  for (const index of path) {
    // Get element children (accounting for mixed content)
    const elementChildren = getElementChildren(current);
    if (index >= elementChildren.length) {
      return null;
    }
    const child = elementChildren[index];
    if (!child) {
      return null;
    }
    current = child;
  }

  return current;
}

/**
 * Get element children from an ElementNode (handles both children and mixed).
 */
function getElementChildren(node: ElementNode): ElementNode[] {
  if (node.mixed) {
    return node.mixed.filter(
      (item): item is ElementNode =>
        typeof item !== "string" && !("comment" in item)
    );
  }
  return node.children;
}
