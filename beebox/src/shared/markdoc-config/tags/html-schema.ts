/**
 * Markdoc schemas for the tags the parse-time token rewrites emit: `html`
 * (`html-tokens.ts`) and the footnote family (`footnote-tokens.ts`). Both
 * render plain HTML elements, so the React renderer and Markdoc's HTML
 * renderer treat them the same way.
 *
 * Authors can also write these tags by hand (`{% html element="sub" %}`);
 * that is harmless, because the transform re-checks the element against the
 * allow-list and attributes are limited to the declared, inert set.
 */

import Markdoc from "@markdoc/markdoc";
import type { Schema, SchemaAttribute } from "@markdoc/markdoc";
import { HTML_RENDER_ATTRIBUTES, htmlElementRule } from "../html-policy.js";

// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { Tag, nodes: baseNodes } = Markdoc;

const BOOLEAN_ATTRIBUTES = new Set<string>(["open", "reversed"]);

const htmlAttributes: Record<string, SchemaAttribute> = {
  element: { type: String, required: true, render: false },
  ...Object.fromEntries(
    HTML_RENDER_ATTRIBUTES.map((name) => [name, { type: BOOLEAN_ATTRIBUTES.has(name) ? Boolean : String }]),
  ),
};

/**
 * The `html` tag. `paragraph` names what an HTML `<p>` renders as: the React
 * renderer passes its `Para` component (a `<div>`, since a box paragraph may
 * hold block-level previews), the HTML renderer keeps `p`.
 */
export function makeHtmlTag({ paragraph }: { paragraph: string }): Schema {
  return {
    attributes: htmlAttributes,
    transform(node, config) {
      const element = node.attributes["element"];
      const children = node.transformChildren(config);
      if (typeof element !== "string" || htmlElementRule(element) === undefined) return children;
      return new Tag(element === "p" ? paragraph : element, node.transformAttributes(config), children);
    },
  };
}

/**
 * `image` node that also carries `width`, which only an HTML `<img width>`
 * sets (`html-tokens.ts`); Markdown image syntax has no way to size.
 */
export const imageNode: Schema = {
  ...baseNodes.image,
  attributes: { ...baseNodes.image.attributes, width: { type: String } },
};

const footnoteNumber: Record<string, SchemaAttribute> = {
  n: { type: Number, required: true, render: false },
  sub: { type: Number, render: false },
};

function numberAttr(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

/** Element id of reference `n` (and its `sub`-th repeat). */
function refId(n: number, sub: unknown): string {
  return typeof sub === "number" && sub > 0 ? `fnref-${String(n)}-${String(sub)}` : `fnref-${String(n)}`;
}

const footnoteRef: Schema = {
  selfClosing: true,
  attributes: footnoteNumber,
  transform(node) {
    const n = numberAttr(node.attributes["n"]);
    return new Tag("sup", { class: "footnote-ref" }, [
      new Tag("a", { href: `#fn-${String(n)}`, id: refId(n, node.attributes["sub"]) }, [String(n)]),
    ]);
  },
};

const footnotes: Schema = {
  transform(node, config) {
    return new Tag("section", { class: "footnotes", "aria-label": "Footnotes" }, [
      new Tag("hr", {}, []),
      new Tag("ol", {}, node.transformChildren(config)),
    ]);
  },
};

const footnoteItem: Schema = {
  attributes: footnoteNumber,
  transform(node, config) {
    return new Tag("li", { id: `fn-${String(numberAttr(node.attributes["n"]))}` }, node.transformChildren(config));
  },
};

const footnoteBackref: Schema = {
  selfClosing: true,
  attributes: footnoteNumber,
  transform(node) {
    const n = numberAttr(node.attributes["n"]);
    return new Tag(
      "a",
      { href: `#${refId(n, node.attributes["sub"])}`, class: "footnote-backref", "aria-label": `Back to reference ${String(n)}` },
      ["↩"],
    );
  },
};

/** Footnote tag schemas, keyed by tag name. */
export const footnoteTags: Record<string, Schema> = {
  "footnote-ref": footnoteRef,
  footnotes,
  footnote: footnoteItem,
  "footnote-backref": footnoteBackref,
};
