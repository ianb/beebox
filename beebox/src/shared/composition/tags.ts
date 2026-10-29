/**
 * The doc card's composition vocabulary (`docs/implemented-plans/composition-editor.md`):
 * two tags valid only in a doc body (`CardSchemaConfig.markdocTags` on the
 * doc schema).
 *
 *  - `composition` — block only, no attributes. Marks the one region of the
 *    body that is the person's piece of writing. Renders `CompositionBlock`.
 *  - `editorial` — the agent's words inside a composition, by `kind`
 *    (`joiner`, `gap`, `note`, `check`). `check` wraps the person's own text
 *    that the agent doubts; its optional `note` says why. Inline or block,
 *    split by `node.inline` like `quote`.
 */
import Markdoc from "@markdoc/markdoc";
import type { Schema } from "@markdoc/markdoc";

// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { Tag } = Markdoc;

export const EDITORIAL_KINDS = ["joiner", "gap", "note", "check"] as const;

const composition: Schema = {
  validate(node) {
    if (!node.inline) return [];
    return [{
      id: "composition-inline",
      level: "error",
      message: "A composition is a block: put {% composition %} and {% /composition %} each on its own line",
    }];
  },
  transform(node, config) {
    return new Tag("CompositionBlock", {}, node.transformChildren(config));
  },
};

const editorial: Schema = {
  attributes: {
    kind: { type: String, required: true, matches: [...EDITORIAL_KINDS] },
    note: { type: String },
  },
  transform(node, config) {
    return new Tag(
      node.inline ? "EditorialInline" : "EditorialBlock",
      node.transformAttributes(config),
      node.transformChildren(config),
    );
  },
};

export const compositionTags: Readonly<Record<string, Schema>> = { composition, editorial };
