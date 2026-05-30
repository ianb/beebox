/**
 * Card patch + element serialization helpers for the REST API.
 *
 * Split out of `api.ts`. These are the pure, self-contained pieces the
 * `/api/card/*` GET and PATCH handlers lean on:
 *
 * - `PatchOp` — the wire shape of a single patch operation
 * - `navigateToChild` / `parseXmlFragment` — element navigation + fragment parse
 * - `JsonElement` / `sanitizeElement` — JSON-safe element tree for the frontend
 */

import type { ElementNode } from "cardworks";

export type PatchOp =
  | { op: "set-attr"; path?: string; attr: string; value: string }
  | { op: "remove-attr"; path?: string; attr: string }
  | { op: "set-text"; path: string; value: string }
  | { op: "append-child"; path?: string; xml: string }
  | { op: "remove-child"; path: string; index: number };

/**
 * Navigate to a child element by a simple path like "section/ingredients/ing[2]".
 * Segments are tag names; [N] picks the Nth match (0-indexed).
 */
export function navigateToChild(el: ElementNode, pathStr: string): ElementNode | null {
  const segments = pathStr.split("/").filter(Boolean);
  let current: ElementNode = el;
  for (const seg of segments) {
    const match = seg.match(/^(\w[\w-]*?)(?:\[(\d+)])?$/);
    if (!match) return null;
    const tagName = match[1]!;
    const idx = match[2] !== undefined ? parseInt(match[2], 10) : 0;
    const matches = current.children.filter(c => c.tagName === tagName);
    if (idx >= matches.length) return null;
    current = matches[idx]!;
  }
  return current;
}

/**
 * Parse a simple XML fragment like `<tag attr="val">text</tag>` into an ElementNode.
 * Very basic — handles single elements only.
 */
export function parseXmlFragment(xml: string): ElementNode | null {
  const match = xml.match(/^<(\w[\w-]*)((?:\s+[\w-]+="[^"]*")*)(?:\s*\/>|>([\S\s]*?)<\/\1>)$/);
  if (!match) return null;
  const tagName = match[1]!;
  const attrStr = match[2] ?? "";
  const text = match[3]?.trim();

  const attrs: Record<string, string> = {};
  const attrRegex = /([\w-]+)="([^"]*)"/g;
  let attrMatch;
  while ((attrMatch = attrRegex.exec(attrStr))) {
    attrs[attrMatch[1]!] = attrMatch[2]!;
  }

  return {
    tagName,
    attrs,
    children: [],
    text: text || undefined,
    comments: {},
    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    dirty: true,
  } as ElementNode;
}

/**
 * JSON-safe element node for the frontend.
 */
export interface JsonElement {
  tagName: string;
  attrs: Record<string, string>;
  text?: string;
  children?: JsonElement[];
}

/**
 * Convert an ElementNode to a JSON-safe structure.
 */
export function sanitizeElement(el: ElementNode): JsonElement {
  const result: JsonElement = {
    tagName: el.tagName,
    attrs: {},
  };

  // Copy string attributes only
  for (const [key, value] of Object.entries(el.attrs)) {
    if (typeof value === "string") {
      result.attrs[key] = value;
    }
  }

  // Include text if present
  if (el.text !== undefined && el.text !== null) {
    result.text = String(el.text).trim();
  }

  // Recursively process children
  if (el.children && Array.isArray(el.children) && el.children.length > 0) {
    result.children = el.children.map((child) => sanitizeElement(child as ElementNode));
  }

  return result;
}
