// # Theme studio search
//
// Draft names must survive routing even before a theme is in the product catalog;
// the system and card choices remain independent.

import { test } from "tap";
import "agent-doctest/tap";
import { themeStudioSearchSchema } from "../../src/lib/theme-studio-search.js";

void test("line 10", async (t) => {
  // doctest:L11
  const defaults = themeStudioSearchSchema.parse({});
  t.check([defaults.system, defaults.systemStock, defaults.card, defaults.cardStock], [
    "plain",
    "neutral",
    "plain",
    "neutral",
  ]);

  // doctest:L15
  const draft = themeStudioSearchSchema.parse({ system: "draft", card: "paper", cardStock: "blue" });
  t.check([draft.system, draft.systemStock, draft.card, draft.cardStock], [
    "draft",
    "neutral",
    "paper",
    "blue",
  ]);

  // doctest:L19
  t.check(themeStudioSearchSchema.safeParse({ system: ["draft", "paper"] }).success, false);
});
