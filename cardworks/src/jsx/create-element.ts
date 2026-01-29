import type { ElementNode, MixedContent, Comments } from "../parser/provenance.js";
import { emptyLocation } from "../parser/provenance.js";

/**
 * Props passed to JSX elements.
 */
export interface JSXProps {
  children?: JSXChild | JSXChild[];
  [key: string]: unknown;
}

/**
 * Valid children in JSX.
 */
export type JSXChild = string | ElementNode | null | undefined;

/**
 * Result of processing children.
 */
interface ProcessedChildren {
  text?: string;
  children: ElementNode[];
  mixed?: MixedContent[];
}

/**
 * Process JSX children into ElementNode format.
 * - Single string → text property
 * - Single element → children array
 * - Array of elements → children array
 * - Mixed strings and elements → mixed array
 */
export function processChildren(children: unknown): ProcessedChildren {
  if (children === undefined || children === null) {
    return { children: [] };
  }

  // Single string child
  if (typeof children === "string") {
    return { text: children, children: [] };
  }

  // Single element child
  if (isElementNode(children)) {
    return { children: [children] };
  }

  // Array of children
  if (Array.isArray(children)) {
    // Filter out null/undefined
    const filtered = children.filter(
      (c): c is string | ElementNode => c !== null && c !== undefined
    );

    if (filtered.length === 0) {
      return { children: [] };
    }

    const hasStrings = filtered.some((c) => typeof c === "string");
    const hasElements = filtered.some((c) => isElementNode(c));

    if (hasStrings && hasElements) {
      // Mixed content: interleaved strings and elements
      const mixed: MixedContent[] = filtered;
      const elementChildren = filtered.filter((c): c is ElementNode =>
        isElementNode(c)
      );
      return { children: elementChildren, mixed };
    } else if (hasElements) {
      // All elements
      return {
        children: filtered.filter((c): c is ElementNode => isElementNode(c)),
      };
    } else {
      // All strings - join them
      return { text: (filtered as string[]).join(""), children: [] };
    }
  }

  return { children: [] };
}

/**
 * Type guard for ElementNode.
 */
function isElementNode(value: unknown): value is ElementNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "tagName" in value &&
    typeof (value as ElementNode).tagName === "string"
  );
}

/**
 * Create an ElementNode from JSX-style arguments.
 * This is the core function that jsx/jsxs call.
 *
 * @param tagName - The element tag name
 * @param props - Props including attributes and children
 * @returns An ElementNode
 */
export function createElement(
  tagName: string,
  props: JSXProps | null
): ElementNode {
  const { children: childrenProp, ...rest } = props ?? {};

  // Process attributes - convert primitives to strings
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string") {
      attrs[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      attrs[key] = value.toString();
    }
    // Objects/arrays are silently ignored - only primitives become attributes
  }

  // Process children
  const { text, children, mixed } = processChildren(childrenProp);

  // Create the element with synthetic location
  const element: ElementNode = {
    tagName,
    attrs,
    comments: {} as Comments,
    children,
    location: emptyLocation("<jsx>"),
    dirty: false,
  };

  // Add optional properties
  if (text !== undefined) {
    element.text = text;
  }

  if (mixed !== undefined) {
    element.mixed = mixed;
  }

  return element;
}
