/**
 * Element-sanitization helper for the REST API's `GET /api/card/*` route.
 *
 * Converts a cardworks `ElementNode` (legacy XML card tree) into a
 * JSON-safe structure for the frontend. The patch helpers that once lived
 * here went away with the unused `card.patch` endpoint.
 */

import type { ElementNode } from "cardworks";

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
