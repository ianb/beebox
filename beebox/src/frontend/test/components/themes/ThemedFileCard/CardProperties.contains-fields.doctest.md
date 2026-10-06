Card Properties retains the internal summary fields excluded from the reading view.

```ts setup
import { cardSummaryRows } from "../../../../src/components/themes/ThemedFileCard/CardProperties.js";
```

```ts
JSON.stringify(cardSummaryRows({ contains: "Plan summary", "contains-evidence": "Plan source notes" }))
=> [{"label":"Contains","value":"Plan summary"},{"label":"Contains evidence","value":"Plan source notes"}]
```
