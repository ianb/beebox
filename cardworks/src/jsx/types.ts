import type { ElementNode } from "../parser/provenance.js";
import type { ElementSchema } from "../schema/element.js";

/**
 * Extract the inferred type from an ElementSchema.
 * This gives us the validated shape of an element.
 */
export type InferElementType<S> = S extends ElementSchema<infer T> ? T : never;

/**
 * Extract JSX props from an ElementSchema.
 * This maps the schema's attrs to JSX props and adds children support.
 */
export type InferJSXProps<S extends ElementSchema> =
  InferElementType<S> extends { attrs: infer A }
    ? A & { children?: ElementNode | ElementNode[] | string }
    : { children?: ElementNode | ElementNode[] | string };

/**
 * Map a record of schemas to JSX IntrinsicElements format.
 * Each key becomes an element name, each value becomes its props type.
 *
 * @example
 * ```typescript
 * const schemas = {
 *   recipe: element("recipe", { attrs: { servings: z.string() } }),
 *   title: element("title", { text: z.string() }),
 * } as const;
 *
 * type Elements = InferJSXElements<typeof schemas>;
 * // { recipe: { servings?: string; children?: ... }; title: { children?: ... } }
 * ```
 */
export type InferJSXElements<T extends Record<string, ElementSchema>> = {
  [K in keyof T]: InferJSXProps<T[K]>;
};

/**
 * Props type for jsx/jsxs runtime functions.
 */
export interface JSXRuntimeProps {
  children?: ElementNode | ElementNode[] | string | (ElementNode | string)[];
  [key: string]: unknown;
}

/**
 * The factory functions returned by defineCardJSX.
 */
export interface CardJSXFactory<T extends Record<string, ElementSchema>> {
  /**
   * JSX runtime function for elements with 0 or 1 child.
   */
  jsx: (tag: keyof T | string, props: JSXRuntimeProps) => ElementNode;

  /**
   * JSX runtime function for elements with multiple children.
   */
  jsxs: (tag: keyof T | string, props: JSXRuntimeProps) => ElementNode;

  /**
   * Fragment support - returns array of children for inserting multiple elements.
   */
  Fragment: (props: { children?: ElementNode | ElementNode[] }) => ElementNode[];

  /**
   * Create a Card from a JSX-created element.
   * Validates against the schema if registered.
   */
  createCard: (path: string, element: ElementNode) => import("../card/card.js").Card;
}
