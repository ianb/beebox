# Composer attachment tokens

`[image#1]`, `[file#2]`, `[selection#3]` — the strings that anchor an
attachment inside the message text. One writer, and readers that accept the
pre-2026-08-25 form (`[image1]`) as well, because every stored transcript,
every persisted draft, and every iOS build that has not updated still uses it.

```ts setup
import { attachmentsBlockStart, composerToken, composerTokenIn, normalizeComposerTokens } from "../../src/shared/composer-tokens.js";
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

## `attachmentsBlockStart` finds the trailing block and nothing else

The `<attachments>` block re-spells the tokens it resolves — `[file#1]: _tmp/…`,
and for an inline image's original file `[image#1]: _tmp/…` — so a reader that
expands or strips `[image#N]` stops here. Only a block that ends the message
counts; anything the user typed mid-sentence is body text.

```ts
const msg = "<typed>see [image#1]</typed>\n<attachments>\n[image#1]: _tmp/a.png\n</attachments>";
msg.slice(attachmentsBlockStart(msg))
=> <attachments>
[image#1]: _tmp/a.png
</attachments>

// Trailing whitespace after the close tag is tolerated.
attachmentsBlockStart(msg + "\n") === msg.indexOf("<attachments>")
=> true

// No block: the whole text is body.
attachmentsBlockStart("<typed>plain</typed>")
=> 20

// A block that does not end the message is body text.
attachmentsBlockStart("<typed>I typed <attachments>x</attachments> by hand</typed>")
=> 59

// Two blocks (the assembler never writes two, but a body can quote one): the
// LAST one, which is the real one.
const two = "<typed><attachments>quoted</attachments></typed>\n<attachments>\n[file#1]: _tmp/b.pdf\n</attachments>";
two.slice(attachmentsBlockStart(two))
=> <attachments>
[file#1]: _tmp/b.pdf
</attachments>
```
