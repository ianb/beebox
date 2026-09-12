# The shared card selection sink

Text selections keep their source even after the user moves elsewhere.

```ts setup
import { createCardContextStore, visibleCardSelectionSink } from "../../../src/frontend/src/components/chat/everywhere/selection-context-store.js";
```

```ts
const context = createCardContextStore();
const captured: string[] = [];
const releaseSink = context.registerSelection((selection) => captured.push(selection.ref));
context.capture({ ref: "/house/pantry.doc.card", text: "Two jars", position: "paragraph 2" });
JSON.stringify(captured)
=> ["/house/pantry.doc.card"]

releaseSink();
```

## Browse detail selects text without claiming attention

The enclosing Browse card supplies its visibility-scoped sink explicitly to
its detail FileView. Detail focus stays suppressed, while FileView attaches the
selected file's ref to its captured text. Hidden Browse supplies no receiver.

```ts
const browseContext = createCardContextStore();
const selections: unknown[] = [];
const unregister = browseContext.registerSelection((selection) => selections.push(selection));
const visibleDetail = visibleCardSelectionSink(true, browseContext);
visibleDetail?.({ ref: "/_content/recipes/Soup.recipe.card", text: "Two carrots", position: "paragraph 3" });
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
