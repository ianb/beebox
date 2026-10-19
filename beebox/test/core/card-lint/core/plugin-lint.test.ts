// # card-lint: plugin `lintCards` dispatch survives a throwing hook
//
// `pluginLintIssues` (`src/core/card-lint/core/plugin-lint.ts`) runs every active
// plugin's `lintCards` over a card. A hook that throws must not abort
// `bbx validate` over the whole box: the throw becomes one warning on that card
// naming the plugin, the card, and the error, and linting continues. The
// `plugins` option stands in for the registry so a fixture hook can misbehave.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { pluginLintIssues } from "../../../../src/core/card-lint/core/plugin-lint.js";
import type { PluginDefinition } from "../../../../src/cards/plugin-definition.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

const fixturePlugin = (lintCards: NonNullable<PluginDefinition["lintCards"]>): PluginDefinition => ({
  name: "courseware",
  description: "Fixture standing in for courseware",
  docs: "src/plugins/courseware/README.md",
  schemas: undefined,
  lintCards,
});

const box = await makeTmpBox();
await box.write("_config/box.json", JSON.stringify({ plugins: ["courseware"] }));
await box.write("_content/store/Bonds.concept-map.card", "---\nconcepts: []\n---\nMap.\n");
const card = { path: box.path("_content/store/Bonds.concept-map.card"), type: "concept-map", fields: { concepts: [] }, boxRoot: box.root };

// ## A throwing hook is one warning, not an exception
void test("A throwing hook is one warning, not an exception", async (t) => {
  // doctest:L31
  const broken = fixturePlugin(async () => { throw new Error("concept map index unreadable"); });
  t.check(await pluginLintIssues({ ...card, plugins: [broken] }), [
    {
      type: "schema",
      severity: "warning",
      message: "the courseware plugin's lintCards threw on _content/store/Bonds.concept-map.card: concept map index unreadable; its checks did not run for this card",
    },
  ]);
});

// A hook that returns normally passes its issues through unchanged:
void test("A hook that returns normally passes its issues through unchanged:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L43
  const quiet = fixturePlugin(async () => [{ type: "schema", severity: "warning", message: "fixture says hello" }]);
  t.check((await pluginLintIssues({ ...card, plugins: [quiet] })).map((issue) => issue.message), [
    "fixture says hello",
  ]);
});
