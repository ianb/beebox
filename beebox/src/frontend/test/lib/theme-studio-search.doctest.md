# Theme studio search

Draft names must survive routing even before a theme is in the product catalog;
the system and card choices remain independent.

```ts setup
import { themeStudioSearchSchema } from "../../src/lib/theme-studio-search.js";
```

```ts
const defaults = themeStudioSearchSchema.parse({});
[defaults.system, defaults.systemStock, defaults.card, defaults.cardStock]
=> ["plain", "neutral", "plain", "neutral"]

const draft = themeStudioSearchSchema.parse({ system: "draft", card: "paper", cardStock: "blue" });
[draft.system, draft.systemStock, draft.card, draft.cardStock]
=> ["draft", "neutral", "paper", "blue"]

themeStudioSearchSchema.safeParse({ system: ["draft", "paper"] }).success
=> false
```
