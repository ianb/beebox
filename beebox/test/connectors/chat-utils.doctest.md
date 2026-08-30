# safeFilename

Converts arbitrary text to a filesystem-safe filename. Strips non-alphanumeric characters (keeping spaces and hyphens), replaces spaces with underscores, and limits to 50 characters.

```ts setup
import { safeFilename } from "../../src/connectors/chat-utils.js";
```

Basic usage — spaces become underscores, punctuation stripped:

```ts
safeFilename("Hello World!")
=> Hello_World

safeFilename("Meeting Notes (2026)")
=> Meeting_Notes_2026
```

Leading and trailing underscores are stripped (e.g. `Tax Documents (2)` would otherwise end in `_` after the `)` becomes blank):

```ts
safeFilename("Tax Documents (2)")
=> Tax_Documents_2

safeFilename("  leading spaces")
=> leading_spaces
```

Hyphens are preserved:

```ts
safeFilename("follow-up notes")
=> follow-up_notes
```

Long strings are truncated to 50 characters:

```ts
safeFilename("A".repeat(100))
=> AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

Falls back to "untitled" when everything is stripped:

```ts
safeFilename("!!!")
=> untitled
```

Custom fallback:

```ts
safeFilename("...", "unnamed")
=> unnamed
```
