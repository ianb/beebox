# Move list: `parseMoveList`

```ts setup
import { parseMoveList } from "../../../../src/dev/layout/move/list.js";
```

## A well-formed list parses; other top-level keys are ignored

```ts
JSON.stringify(
  parseMoveList(JSON.stringify({ moves: [{ from: "a.ts", to: "b.ts" }], notes: "ignored" })),
)
=> [{"from":"a.ts","to":"b.ts"}]
```

## Invalid JSON, a missing `moves` array, and a malformed entry each throw

```ts
parseMoveList("not json")
=> throws MoveListNotJsonError

parseMoveList(JSON.stringify({}))
=> throws MoveListShapeError

parseMoveList(JSON.stringify({ moves: ["x"] }))
=> throws MoveEntryNotObjectError

parseMoveList(JSON.stringify({ moves: [{ to: "b.ts" }] }))
=> throws MoveEntryMissingFromError

parseMoveList(JSON.stringify({ moves: [{ from: "a.ts", to: "" }] }))
=> throws MoveEntryMissingToError
```
