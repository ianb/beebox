# What a mirrored folder says about each of its children

The `gfolder` view shows the directory it mounts with one column added: what
each child is to Drive. That column is `driveChildState`
(`frontend/src/lib/drive-card-display.ts`), a pure lookup over the two fields
`status.browse` already reports per card — `type` and `conflict`.

Pure on purpose. The view shows **box state**, never a live Drive listing, so
the column has exactly as much authority as the cards on disk. A child reads
"synced" because its own card says so.

```ts setup
import {
  DRIVE_CHILD_BADGES,
  driveChildState,
} from "../../src/lib/drive-card-display.js";

/** The label the column would show for a `status.browse` card entry. */
function column(card: { type: string; conflict?: boolean }): string {
  return DRIVE_CHILD_BADGES[driveChildState(card)].label;
}
```

## A Doc or a Sheet is content the box holds both ends of

```ts
column({ type: "gdoc" })
=> synced

column({ type: "gsheet" })
=> synced
```

## A conflicted child says so instead of passing as synced

The whole reason the column exists (plan failure mode: "renderer shows a child
as synced while its sync failed"). `conflict: true` is the child's own field,
read off the child — a mount can have no `error` for a listing that succeeded
while one child's content sync did not.

```ts
column({ type: "gdoc", conflict: true })
=> conflict

DRIVE_CHILD_BADGES[driveChildState({ type: "gsheet", conflict: true })].tone
=> danger
```

`conflict: false` is no conflict.

```ts continue
column({ type: "gdoc", conflict: false })
=> synced
```

## Pointers and nested mounts are distinct kinds, not degraded files

```ts
column({ type: "glink" })
=> pointer

column({ type: "gfolder" })
=> subfolder mount
```

A pointer is never "synced": nothing was copied, so calling it synced would
promise a local copy that does not exist.

```ts continue
column({ type: "glink", conflict: true })
=> pointer
```

## A card Drive knows nothing about is named, not hidden

Someone can write a memo into a mirrored directory. The mirror leaves it alone,
and the column says that rather than implying the mirror covers it.

```ts
column({ type: "memo" })
=> not a Drive card

column({ type: "landmark" })
=> not a Drive card
```

## Every state has a badge

The column renders `DRIVE_CHILD_BADGES[state]`, so a state added without an
entry would render `undefined` at runtime. Pin the coverage.

```ts
Object.keys(DRIVE_CHILD_BADGES).toSorted().join(",")
=> conflict,not-drive,pointer,subfolder,synced

Object.values(DRIVE_CHILD_BADGES).every((badge) => badge.label !== "" && badge.title !== "")
=> true
```
