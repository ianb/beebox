// # Recipe plugin: the recipe view
//
// `src/plugins/recipe/view.tsx` is the view a box gives its `recipe` cards. A stub
// at `src/views/recipe.tsx` re-exports it as the default and declares the view
// metadata (`rendersCardTypes`, a `dependencies` glob selecting recipe cards). The
// host sets `params.path` to the card being displayed; the view finds it in
// `cards` and renders its body through the `Markdown` widget with the recipe's
// scoped tags and components.
//
// This renders the built plugin view the way `bbx view check` does after its
// compile step: `dist/plugins/recipe/view.js` is built by the real plugin build
// step, imported through the package `exports` map, given the cards the real
// loader selects, and rendered to a string inside `NodeViewHostProvider`. The
// bundle carries its own Markdoc copy; a `Tag` it builds still renders in the
// host because Markdoc identifies tags by a string check, so the assertions below
// fail if any tag's content is missing.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, not } from "@ianbicking/tap-check/check";
import { makeTmpBox, type TmpBox } from "../../helpers/test-helpers.js";
import { buildPluginBundlesIntoDist } from "../../helpers/plugin-bundles.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { buildProps } from "../../../src/cli/commands/view/command.js";
import { loadViewCards } from "../../../src/core/views/cards.js";

await buildPluginBundlesIntoDist();
const view = await import("beebox/plugins/recipe/view");
const { NodeViewHostProvider } = await import("beebox/view-widgets");

// A box activates the plugin by naming it in `_config/box.json` and writing the
// stubs its README lists: the schema stub makes `recipe` a card type the loader
// recognizes; the view stub is the view under test.
const SCHEMA_STUB = `import { cardSchema } from "beebox/cards";
import recipe from "beebox/plugins/recipe";
export default cardSchema("recipe", recipe.schemas["recipe"]);
`;
async function activateRecipe(box: TmpBox) {
  await box.write("_config/box.json", JSON.stringify({ plugins: ["recipe"] }, null, 2) + "\n");
  await mkdir(join(box.root, "src", "schemas"), { recursive: true });
  await writeFile(join(box.root, "src", "schemas", "recipe.ts"), SCHEMA_STUB);
}

/** What `bbx view check` does after compiling: props from the real card loader, rendered in the node view host. */
async function renderRecipe(box: TmpBox, params: Record<string, string>) {
  const { cards, files } = await loadViewCards(box.root, ["**/*.recipe.card"]);
  const props = buildProps({ cards, files, params, boxSlug: "test" });
  return renderToString(createElement(NodeViewHostProvider, { boxSlug: "test", children: createElement(view.default, props) }));
}

const CARD_PATH = "_content/recipes/Dinner.recipe.card";
const DINNER = `---
title: Dinner
description: A weeknight pasta.
sources:
  - { label: The Kitchen }
tags: [pasta]
---
{% yield amount="4" %}4 servings{% /yield %}

- {% ingredient amount="2" unit="cups" %}flour{% /ingredient %}

{% recipe-section name="Sauce" %}
{% subrecipe ref="/_content/recipes/Marinara.recipe.card" %}Make a half batch.{% /subrecipe %}
{% /recipe-section %}

{% step %}Mix the {% ingredient amount="1" unit="tsp" %}salt{% /ingredient %} in.{% /step %}

{% substitution for="flour" %}Use whole wheat.{% /substitution %}
`;

// ## A recipe renders with every tag resolved
//
// `params.path` names the card, and the view finds it in `cards`. The yield text,
// an ingredient amount with its unit, the step text, the substitution, the section
// name and the subrecipe's link target all reach the page, and no raw `{%` is
// left:
void test("params.path names the card, and the view finds it in cards.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ deps: true, git: true });
  await activateRecipe(box);
  await box.write(CARD_PATH, DINNER);
  await box.write("_content/recipes/Marinara.recipe.card", "---\ntitle: Marinara\n---\n{% yield amount=\"2\" %}2 cups{% /yield %}\n");

  const html = await renderRecipe(box, { path: CARD_PATH });
  const text = html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "");
  // The page is generated HTML, so each check keeps the one fragment it names.
  t.check(text, any(String).includes("4 servings"));
  t.check(text, any(String).includes("2 cups"));
  t.check(text, any(String).includes("1 tsp"));
  t.check(text, any(String).includes("in."));
  t.check(text, any(String).includes("Use whole wheat."));
  t.check(text, any(String).includes("Sauce"));
  t.check(text, any(String).includes("Marinara"));
  t.check(html, any(String).includes("Marinara.recipe.card"));
  t.check(html, not(any(String).includes("{%")));

  // ## A scaled range yield renders its numbers, not an object
  //
  // `scaleAmount` returns a React element for a range, so the yield renders it as a
  // node beside the remaining label text.

  const { makeRecipeComponents, RecipeScaleContext } = await import("../../../src/plugins/recipe/view/tags.js");
  const { RecipeYield } = makeRecipeComponents();
  const scaledYield = renderToString(createElement(RecipeScaleContext.Provider, { value: 2 },
    createElement(RecipeYield, { amount: "2-3" }, "2-3 servings")));
  const scaledText = scaledYield.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "");
  t.check(scaledText, any(String).includes("4–6 servings"));
  t.check(scaledText, not(any(String).includes("[object Object]")));

  // ## Without a matching card the view says so

  const bare = await renderRecipe(box, {});
  t.check(bare, any(String).includes("This recipe card is not available."));
});
