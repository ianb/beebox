# Card attention and the shared selection sink

Opening an overlay temporarily changes what is being inspected. Closing it
restores the underlying card, without touching the conversational recipient.
Text selections keep their source even after the user moves elsewhere.

```ts setup
import { createCardContextStore, visibleCardSelectionSink } from "../../../src/frontend/src/components/chat/everywhere/card-context-store.js";
```

```ts
const context = createCardContextStore();
const page = {};
const overlay = {};
context.focus(page, "/kitchen/recipe.doc.card");
context.focus(overlay, "/house/pantry.doc.card");
context.get()
=> /house/pantry.doc.card

context.release(overlay);
context.get()
=> /kitchen/recipe.doc.card

const captured: string[] = [];
const releaseSink = context.registerSelection((selection) => captured.push(selection.ref));
context.capture({ ref: "/house/pantry.doc.card", text: "Two jars", position: "paragraph 2" });
context.focus(page, "/garden/planting.doc.card");
JSON.stringify(captured)
=> ["/house/pantry.doc.card"]

context.release(page);
context.get()
=> null

releaseSink();
```

Route fallback follows the same query parsing as the mounted ViewPage.

```ts
const { routeCardAttentionRef } = await import("../../../src/frontend/src/components/chat/everywhere/route-attention.js");
routeCardAttentionRef("notes.doc.card", "?view=raw")
=> /notes.doc.card?view=raw
```

## Browse detail selects text without claiming attention

The enclosing Browse card supplies its visibility-scoped sink explicitly to
its detail FileView. Detail focus stays suppressed, while FileView attaches the
selected file's ref to its captured text. Hidden Browse supplies no receiver.

```ts
const browseContext = createCardContextStore();
const browseOwner = {};
browseContext.focus(browseOwner, "/_config/interface/browse.card");
const selections: unknown[] = [];
const unregister = browseContext.registerSelection((selection) => selections.push(selection));
const visibleDetail = visibleCardSelectionSink(true, browseContext);
visibleDetail?.({ ref: "/_content/recipes/Soup.recipe.card", text: "Two carrots", position: "paragraph 3" });
browseContext.get()
=> /_config/interface/browse.card

JSON.stringify(selections)
=> [{"ref":"/_content/recipes/Soup.recipe.card","text":"Two carrots","position":"paragraph 3"}]

const hiddenDetail = visibleCardSelectionSink(false, browseContext);
hiddenDetail?.({ ref: "/_content/recipes/Soup.recipe.card", text: "Hidden text", position: "paragraph 4" });
selections.length
=> 1

hiddenDetail === undefined
=> true

unregister();
```
