# Filename helpers

Shared filename helpers used by both backend (connectors, CLI) and frontend (capture upload).

```ts setup
import {
  sanitizeFilenameStem,
  sanitizeFilename,
  splitExtension,
} from "../src/lib/filename.js";
```

## sanitizeFilenameStem

Sanitizes a display string into a filename stem (no extension). Keeps alphanumerics, underscores, and hyphens; collapses whitespace runs into underscores; strips leading/trailing separators; caps at 50 chars.

```ts
sanitizeFilenameStem("Hello World!")
=> Hello_World

sanitizeFilenameStem("Tax Documents (2)")
=> Tax_Documents_2

sanitizeFilenameStem("  leading spaces")
=> leading_spaces
```

Underscores inside the text are preserved (only punctuation is stripped):

```ts
sanitizeFilenameStem("tax_return 2024")
=> tax_return_2024
```

Falls back to `"untitled"` (or a custom fallback) when nothing survives:

```ts
sanitizeFilenameStem("!!!")
=> untitled

sanitizeFilenameStem("...", { fallback: "unnamed" })
=> unnamed
```

## splitExtension

Splits a filename into `{ stem, ext }`, where `ext` includes the leading dot. A leading dot (dotfile) or a name with no dot returns an empty `ext`:

```ts
JSON.stringify(splitExtension("Tax Documents (2).pdf"))
=> {"stem":"Tax Documents (2)","ext":".pdf"}

JSON.stringify(splitExtension("README"))
=> {"stem":"README","ext":""}

JSON.stringify(splitExtension(".gitignore"))
=> {"stem":".gitignore","ext":""}
```

## sanitizeFilename

Sanitizes a full filename including its extension — this is the one used for files uploaded from disk (where we want to preserve `.pdf`, `.jpg`, etc.):

```ts
sanitizeFilename("Tax Documents (2).pdf")
=> Tax_Documents_2.pdf

sanitizeFilename("my photo.JPG")
=> my_photo.JPG

sanitizeFilename("no-extension-here")
=> no-extension-here
```

Custom fallback used when the stem would otherwise be empty:

```ts
sanitizeFilename("....pdf", { fallback: "upload" })
=> upload.pdf
```
