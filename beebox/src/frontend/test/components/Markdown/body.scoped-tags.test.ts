// # Scoped Markdoc tags in the Markdown widget
//
// A type's `markdocTags` reach the widget as the `tags` prop and render through
// the `components` prop. A tag the active table does not know renders as the
// text the author wrote, so nothing disappears on a surface without the type's
// tags (`docs/implemented-plans/plugins-slice-2.md`, Track 1). The tag names below are not
// in the core table; `subrecipe` and `ingredient` still are until the recipe
// plugin takes them.

import { test } from "tap";
import "agent-doctest/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdoc, { type Schema } from "@markdoc/markdoc";
import { Markdown } from "../../../src/components/Markdown/body.js";
import { BoxSlugProvider } from "../../../src/lib/box-slug.js";

// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { Tag } = Markdoc;

globalThis.React = React;

const render = (text: string, extra?: Pick<React.ComponentProps<typeof Markdown>, "tags" | "components">): string =>
  renderToStaticMarkup(
    React.createElement(BoxSlugProvider, {
      boxSlug: "test",
      children: React.createElement(Markdown, { onNavigate: () => {}, ...extra, children: text }),
    }),
  );

const garnish: Schema = {
  attributes: { amount: { type: String }, unit: { type: String } },
  transform: (node, config) => new Tag("Garnish", node.transformAttributes(config), node.transformChildren(config)),
};
const Garnish = ({ amount, unit, children }: { amount?: string; unit?: string; children?: React.ReactNode }) =>
  React.createElement("b", { className: "garnish" }, `[${amount} ${unit}] `, children);

// ## Without `tags`, the authored tag and its attributes stay visible
void test("Without `tags`, the authored tag and its attributes stay visible", async (t) => {
  // doctest:L40
  const plain = render('Top with {% garnish amount="2" unit="cups" %}flour{% /garnish %}.');
  await t.checkText(plain.includes("garnish amount=&quot;2&quot; unit=&quot;cups&quot;") && plain.includes("flour"), "true");
});

// ## With `tags` and `components`, the component renders and no authored tag text remains
void test("With `tags` and `components`, the component renders and no authored tag text remains", async (t) => {
  // doctest:L48
  const scoped = render('Top with {% garnish amount="2" unit="cups" %}flour{% /garnish %}.', {
    tags: { garnish },
    components: { Garnish },
  });
  await t.checkText(scoped.includes('<b class="garnish">[2 cups] flour</b>') && !scoped.includes("{%"), "true");
});

// ## A block tag keeps its attribute values visible
void test("A block tag keeps its attribute values visible", async (t) => {
  // doctest:L59
  const block = render('{% plating ref="x.recipe.card" %}\nBody\n{% /plating %}');
  await t.checkText(block.includes("plating ref=&quot;x.recipe.card&quot;"), "true");
});

// ## A variable attribute prints as authored
void test("A variable attribute prints as authored", async (t) => {
  // doctest:L67
  await t.checkText(render("{% garnish amount=$n %}x{% /garnish %}").includes("{% garnish amount=$n %}"), "true");
});

// ## A tag named after an Object.prototype key is still unknown
void test("A tag named after an Object.prototype key is still unknown", async (t) => {
  // doctest:L74
  await t.checkText(render('{% toString amount="2" %}flour{% /toString %}').includes("toString amount=&quot;2&quot;"), "true");
});
