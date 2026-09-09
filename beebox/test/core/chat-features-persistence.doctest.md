# Chat Features: Persistence

Feature flags live on `SessionHistoryEntry` in
`.beebox/chat-session-history.json`. `updateFeaturesForSession`
writes a partial update; `getFeaturesForSession` reads what's there.
Pre-existing sessions without a `features` field continue working —
missing means "all defaults," resolved at read time by `resolveFeatures`
(covered in `chat-features.doctest.md`).

```ts setup
import {
  appendHistory,
  getFeaturesForSession,
  loadHistoryEntries,
  updateFeaturesForSession,
} from "../../src/core/chat/session/history.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

## Reading from an unknown session

```ts
const box = await makeTmpBox();
await getFeaturesForSession(box.root, "sess-1")
=> null
```

```ts cleanup
await box.cleanup();
```

## Writing then reading

`updateFeaturesForSession` creates the entry if it doesn't exist yet.
This matters for the agent-delta path: the agent might emit a
`<chat-app>` mutation in its first turn, before any explicit toggle.

```ts
const box = await makeTmpBox();
await updateFeaturesForSession(box.root, {
  sessionId: "sess-1",
  updates: { narration: "on" },
});
JSON.stringify(await getFeaturesForSession(box.root, "sess-1"))
=> {"narration":"on"}
```

```ts cleanup
await box.cleanup();
```

## Partial updates merge

Only the keys passed to `updateFeaturesForSession` change; existing
keys not in the update are preserved.

```ts
const box = await makeTmpBox();
await updateFeaturesForSession(box.root, {
  sessionId: "sess-1",
  updates: { narration: "on", prose: "off" },
});
await updateFeaturesForSession(box.root, {
  sessionId: "sess-1",
  updates: { prose: "on" },
});
JSON.stringify(await getFeaturesForSession(box.root, "sess-1"))
=> {"narration":"on","prose":"on"}
```

```ts cleanup
await box.cleanup();
```

## Coexists with contextDir

Existing sessions added via `appendHistory` keep their `contextDir` —
updating features doesn't disturb it, and vice versa.

```ts
const box = await makeTmpBox();
await appendHistory(box.root, { sessionId: "sess-1", contextDir: "_content/recipes" });
await updateFeaturesForSession(box.root, {
  sessionId: "sess-1",
  updates: { narration: "on" },
});
const entries = await loadHistoryEntries(box.root);
JSON.stringify(entries[0])
=> {"id":"sess-1","engine":"claude","contextDir":"_content/recipes","features":{"narration":"on"}}
```

```ts cleanup
await box.cleanup();
```
