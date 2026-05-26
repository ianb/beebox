/**
 * JSX automatic runtime for cardworks.
 *
 * This module is imported automatically by TypeScript/Babel when using
 * the "react-jsx" transform with jsxImportSource: "cardworks/jsx"
 */

import { createElement } from "./create-element.js";
import type { ElementNode } from "../parser/provenance.js";

export { createElement };

/**
 * JSX runtime function for single or no children.
 */
export function jsx(
  tag: string,
  props: Record<string, unknown>
): ElementNode {
  return createElement(tag, props);
}

/**
 * JSX runtime function for multiple children.
 */
export function jsxs(
  tag: string,
  props: Record<string, unknown>
): ElementNode {
  return createElement(tag, props);
}

/**
 * Fragment support - returns children as array.
 */
export function Fragment(props: {
  children?: ElementNode | ElementNode[];
}): ElementNode[] {
  const { children } = props;
  if (!children) {
    return [];
  }
  if (Array.isArray(children)) {
    return children;
  }
  return [children];
}

// Re-export types for JSX namespace
export type { JSXProps, JSXChild } from "./create-element.js";

/**
 * JSX namespace for TypeScript type checking.
 * Allows any element name with any props.
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace JSX {
  export type Element = ElementNode;
  export interface IntrinsicElements {
    [elemName: string]: Record<string, unknown>;
  }
}
