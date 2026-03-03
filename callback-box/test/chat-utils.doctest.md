# safeFilename

Converts arbitrary text to a filesystem-safe filename. Strips non-alphanumeric characters (keeping spaces and hyphens), replaces spaces with underscores, and limits to 50 characters.

```ts setup
import { safeFilename } from "../src/connectors/chat-utils.js";
```

Basic usage — spaces become underscores, punctuation stripped:

```
safeFilename("Hello World!")
=> Hello_World

safeFilename("Meeting Notes (2026)")
=> Meeting_Notes_2026
```

Hyphens are preserved:

```
safeFilename("follow-up notes")
=> follow-up_notes
```

Long strings are truncated to 50 characters:

```
safeFilename("A".repeat(100))
=> AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

Falls back to "untitled" when everything is stripped:

```
safeFilename("!!!")
=> untitled
```

Custom fallback:

```
safeFilename("...", "unnamed")
=> unnamed
```
