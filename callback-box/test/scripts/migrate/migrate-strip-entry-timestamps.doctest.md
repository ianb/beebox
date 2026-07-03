# Migration: strip file-metadata timestamps from guide/personality cards

`scripts/migrate/strip-entry-timestamps.ts` removes `created-at` / `updated-at` /
`added-at` keys from guide and personality cards — git is the record of when
something was written, and a fresh `created-at` on every regen was a
template-churn source. `stripTimestamps(node)` mutates the parsed frontmatter in
place (deleting those keys at any depth) and returns whether anything changed.

```ts setup
import { stripTimestamps } from "../../../scripts/migrate/strip-entry-timestamps.js";

// Strip in place, then report the boolean + the cleaned object as one JSON blob.
function stripped(obj: Record<string, unknown>): string {
  const changed = stripTimestamps(obj);
  return JSON.stringify({ changed, obj });
}
```

## Nested `created-at` / `updated-at` under experiments are removed

```ts
stripped({ version: "1.0.0", experiments: [{ id: "x", status: "active", "created-at": "2026-05-16T00:00:00Z", "updated-at": "2026-06-01T00:00:00Z", hypothesis: "h" }] })
=> {"changed":true,"obj":{"version":"1.0.0","experiments":[{"id":"x","status":"active","hypothesis":"h"}]}}
```

## `added-at` under context-notes is removed

```ts
stripped({ "context-notes": [{ text: "note", duration: "ongoing", "added-at": "2026-05-16T00:00:00Z" }] })
=> {"changed":true,"obj":{"context-notes":[{"text":"note","duration":"ongoing"}]}}
```

## A card with none of the keys is unchanged (idempotent second run)

```ts
stripped({ version: "1.0.0", experiments: [{ id: "x", hypothesis: "h" }] })
=> {"changed":false,"obj":{"version":"1.0.0","experiments":[{"id":"x","hypothesis":"h"}]}}
```
