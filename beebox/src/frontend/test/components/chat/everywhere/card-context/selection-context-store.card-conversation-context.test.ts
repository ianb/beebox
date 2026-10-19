// # The shared card selection sink
//
// Text selections keep their source even after the user moves elsewhere.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createCardContextStore, visibleCardSelectionSink } from "../../../../../src/components/chat/everywhere/card-context/selection-context-store.js";

void test("line 9", async (t) => {
  // doctest:L10
  const context = createCardContextStore();
  const captured: (string | null)[] = [];
  const releaseSink = context.registerSelection((selection) => captured.push(selection.ref));
  context.capture({ ref: "/house/pantry.doc.card", text: "Two jars", position: "paragraph 2" });
  t.check(captured, [
    "/house/pantry.doc.card",
  ]);

  // doctest:L17
  releaseSink();
});

// ## Browse detail selects text without claiming attention
//
// The enclosing Browse card supplies its visibility-scoped sink explicitly to
// its detail FileView. Detail focus stays suppressed, while FileView attaches the
// selected file's ref to its captured text. Hidden Browse supplies no receiver.
void test("The enclosing Browse card supplies its visibility-scoped sink explicitly to i...", async (t) => {
  // doctest:L27
  const browseContext = createCardContextStore();
  const selections: unknown[] = [];
  const unregister = browseContext.registerSelection((selection) => selections.push(selection));
  const visibleDetail = visibleCardSelectionSink(true, browseContext);
  visibleDetail?.({ ref: "/_content/recipes/Soup.recipe.card", text: "Two carrots", position: "paragraph 3" });
  t.check(selections, [
    {
      ref: "/_content/recipes/Soup.recipe.card",
      text: "Two carrots",
      position: "paragraph 3",
    },
  ]);

  // doctest:L35
  const hiddenDetail = visibleCardSelectionSink(false, browseContext);
  hiddenDetail?.({ ref: "/_content/recipes/Soup.recipe.card", text: "Hidden text", position: "paragraph 4" });
  t.check(selections, [{ ref: "/_content/recipes/Soup.recipe.card", text: "Two carrots", position: "paragraph 3" }]);

  // doctest:L40
  t.check(hiddenDetail, undefined);

  // doctest:L43
  unregister();
});
