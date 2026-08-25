# Composer attachment tokens

`[image#1]`, `[file#2]`, `[selection#3]` — the strings that anchor an
attachment inside the message text. One writer, and readers that accept the
pre-2026-08-25 form (`[image1]`) as well, because every stored transcript,
every persisted draft, and every iOS build that has not updated still uses it.

```ts setup
import { composerToken, composerTokenIn, normalizeComposerTokens } from "../../src/shared/composer-tokens.js";
```

## The writer emits one form

```ts
[composerToken("image", 1), composerToken("file", 12), composerToken("selection", 3)].join(" ")
=> [image#1] [file#12] [selection#3]
```

## `composerTokenIn` reports the spelling the text actually uses

This is what keeps one message internally consistent: the `<attachments>`
block labels each file the way the body refers to it, whichever era the body
came from.

```ts
composerTokenIn("compare [file#1] against the notes", { kind: "file", id: 1 })
=> [file#1]

composerTokenIn("compare [file1] against the notes", { kind: "file", id: 1 })
=> [file1]
```

Null when the text does not anchor that attachment — including the near
misses, so a two-digit id is never read as its one-digit prefix.

```ts
JSON.stringify([
  composerTokenIn("no tokens here", { kind: "file", id: 1 }),
  composerTokenIn("see [file#12]", { kind: "file", id: 1 }),
  composerTokenIn("see [image#1]", { kind: "file", id: 1 }),
])
=> [null,null,null]
```

## `normalizeComposerTokens` upgrades a restored draft

Applied when a composition written before the rename re-enters a live
composer, so what the user is handed back reads like a freshly-attached one.

```ts
normalizeComposerTokens("look at [image1] and [file2] about [selection3]")
=> look at [image#1] and [file#2] about [selection#3]
```

Already-current tokens pass through unchanged, and it is idempotent:

```ts
normalizeComposerTokens(normalizeComposerTokens("mixed [image1] and [image#2]"))
=> mixed [image#1] and [image#2]
```

Text that merely looks like a token is not one — a bracketed word with no id,
or a markdown link — and survives untouched. So does a token the user typed
for an attachment they never made: normalizing is a rewrite of spelling, not a
claim that the reference resolves.

```ts
normalizeComposerTokens("see [image] and [file: here] and [selection99]")
=> see [image] and [file: here] and [selection#99]
```
