# Recovered Dictation Minimum Size

Recovered dictation is worth surfacing only when its trimmed text is longer
than 20 characters. Short scraps are classified for silent removal by the
recovery hook instead of rendering its recovery affordance.

```ts setup
import {
  dropSmallRecoveredDictation,
  RECOVERED_DICTATION_MIN_CHARACTERS,
  shouldSurfaceRecoveredDictation,
} from "../../../../src/frontend/src/components/chat/InteractiveChat-recovery.js";
```

One- and two-word scraps stay below the floor:

```ts
shouldSurfaceRecoveredDictation("hello")
=> false

shouldSurfaceRecoveredDictation("just mumbling")
=> false
```

The hook's drop path uses the same decision and clears a short persisted draft:

```ts
let clearedDrafts = 0;
const dropped = dropSmallRecoveredDictation("just mumbling", () => { clearedDrafts += 1; });
({ dropped, clearedDrafts })
=>
{
  "dropped": true,
  "clearedDrafts": 1
}
```

Whitespace does not inflate the recovered draft's size, and exactly 20
characters is still below the strict threshold:

```ts
shouldSurfaceRecoveredDictation(`  ${"x".repeat(RECOVERED_DICTATION_MIN_CHARACTERS)}  `)
=> false
```

A longer recovery is surfaced:

```ts
shouldSurfaceRecoveredDictation("This recovered draft is useful.")
=> true

let clearedDrafts = 0;
const dropped = dropSmallRecoveredDictation(
  "This recovered draft is useful.",
  () => { clearedDrafts += 1; },
);
({ dropped, clearedDrafts })
=>
{
  "dropped": false,
  "clearedDrafts": 0
}
```
