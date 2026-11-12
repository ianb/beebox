// # Markdoc `{% composition %}` and `{% editorial %}`
//
// The doc card's scoped tags: a block-only composition that renders
// `CompositionBlock`, and an editorial mark split inline/block like `quote`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import Markdoc, { type Tag } from "@markdoc/markdoc";
import { withScopedTags } from "../../../src/shared/markdoc-config/scoped.js";
import { compositionTags } from "../../../src/shared/composition/tags.js";

// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { parse, transform, validate } = Markdoc;

const config = withScopedTags(compositionTags);

function isTag(value: unknown): value is Tag {
  return typeof value === "object" && value !== null && "name" in value;
}

/** Tag names and attributes, depth first, so a check reads as the rendered shape. */
function shape(value: unknown): unknown {
  if (!isTag(value)) return value;
  return { name: value.name, attributes: value.attributes, children: value.children.map(shape) };
}

function errors(src: string): string[] {
  return validate(parse(src), config).map((entry) => entry.error.id ?? entry.error.message);
}

// ## Block composition with inline and block marks
void test("renders CompositionBlock with editorial marks", async (t) => {
  const src = '{% composition %}\nText {% editorial kind="check" note="unclear" %}a week{% /editorial %}.\n\n{% editorial kind="note" %}\nEnd here?\n{% /editorial %}\n{% /composition %}\n';
  t.check(errors(src), []);
  t.check(shape(transform(parse(src), config)), {
    name: "article",
    attributes: {},
    children: [{
      name: "CompositionBlock",
      attributes: {},
      children: [
        { name: "p", attributes: {}, children: ["Text ", { name: "EditorialInline", attributes: { kind: "check", note: "unclear" }, children: ["a week"] }, "."] },
        { name: "EditorialBlock", attributes: { kind: "note" }, children: [{ name: "p", attributes: {}, children: ["End here?"] }] },
      ],
    }],
  });
});

// ## Inline composition and bad or missing kinds are errors
void test("validation errors", async (t) => {
  t.check(errors("Text {% composition %}x{% /composition %}.\n"), ["composition-inline"]);
  t.check(errors('{% editorial kind="other" %}x{% /editorial %}\n'), ["attribute-value-invalid"]);
  t.check(errors("{% editorial %}x{% /editorial %}\n"), ["attribute-missing-required"]);
});
