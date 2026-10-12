import Markdoc from "@markdoc/markdoc";
import type { Schema } from "@markdoc/markdoc";

// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { Tag } = Markdoc;

// Render-time stand-in for a tag the active table does not know
// (`rewriteUnknownTags` in `../scoped.ts`): the authored opening tag stays
// visible, followed by the children. Not an authored tag.
export const unknownTag: Schema = {
  attributes: {
    name: { type: String },
    attrs: { type: String },
  },
  transform(node, config) {
    return new Tag(
      node.inline ? "UnknownTagInline" : "UnknownTagBlock",
      node.transformAttributes(config),
      node.transformChildren(config),
    );
  },
};
