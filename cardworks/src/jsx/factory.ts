import type { ElementNode } from "../parser/provenance.js";
import type { ElementSchema } from "../schema/element.js";
import type { Card } from "../card/card.js";
import type { FileSystem } from "../fs/types.js";
import type { CardJSXFactory, JSXRuntimeProps } from "./types.js";
import { createElement } from "./create-element.js";
import { NewCardImpl } from "../card/card.js";
import type { ZodError } from "zod";

/**
 * Default version for JSX-created elements without explicit version.
 */
const DEFAULT_VERSION = "1.0.0";

/**
 * Error thrown when JSX card creation fails validation.
 */
export class JSXValidationError extends Error {
  constructor(
    message: string,
    public readonly tagName: string,
    public readonly zodError: ZodError
  ) {
    super(message);
    this.name = "JSXValidationError";
  }
}

/**
 * Options for createCard function.
 */
export interface CreateCardOptions {
  /** FileSystem to use for media file detection (optional) */
  fs?: FileSystem;
}

/**
 * Create a schema-bound JSX factory.
 *
 * This returns jsx/jsxs functions that create ElementNodes, a Fragment
 * function for grouping children, and a createCard function that validates
 * and wraps elements as Cards.
 *
 * @example
 * ```typescript
 * const schemas = {
 *   recipe: element("recipe", { attrs: { servings: z.string() } }),
 *   title: element("title", { text: z.string() }),
 * } as const;
 *
 * const { jsx, jsxs, Fragment, createCard } = defineCardJSX(schemas);
 *
 * // In a TSX file:
 * const element = (
 *   <recipe version="1.0.0" servings="4">
 *     <title>Pasta</title>
 *   </recipe>
 * );
 *
 * const card = createCard("/project/Recipe.card", element);
 * ```
 */
export function defineCardJSX<T extends Record<string, ElementSchema>>(
  schemas: T,
  options: CreateCardOptions = {}
): CardJSXFactory<T> {
  /**
   * JSX runtime function for single or no children.
   * Called by the JSX transform for elements like <foo /> or <foo>single</foo>
   */
  function jsx(tag: keyof T | string, props: JSXRuntimeProps): ElementNode {
    const tagName = String(tag);
    return createElement(tagName, props);
  }

  /**
   * JSX runtime function for multiple children.
   * Called by the JSX transform for elements like <foo><a/><b/></foo>
   */
  function jsxs(tag: keyof T | string, props: JSXRuntimeProps): ElementNode {
    // Same implementation as jsx - children handling is done in createElement
    const tagName = String(tag);
    return createElement(tagName, props);
  }

  /**
   * Fragment support for grouping multiple elements.
   * <><a/><b/></> returns [<a/>, <b/>]
   */
  function Fragment(props: {
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

  /**
   * Create a Card from a JSX-created ElementNode.
   * Validates against the schema if one is registered for the tag name.
   */
  function createCard(path: string, element: ElementNode): Card {
    // Add default version if not present
    if (!element.attrs["version"]) {
      element.attrs["version"] = DEFAULT_VERSION;
    }

    // Validate against schema if registered
    const schema = schemas[element.tagName as keyof T];
    if (schema) {
      const result = schema.safeParse(element);
      if (!result.success) {
        throw new JSXValidationError(
          `JSX validation failed for <${element.tagName}>: ${result.error.message}`,
          element.tagName,
          result.error
        );
      }
    }

    // Create as new card (never loaded from disk)
    return new NewCardImpl(path, element, options.fs);
  }

  return { jsx, jsxs, Fragment, createCard };
}
