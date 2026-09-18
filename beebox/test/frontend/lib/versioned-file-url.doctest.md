# Versioned file URLs

PDF viewers may retain a document by URL, independently of ordinary HTTP
revalidation. The PDF renderers append the current file ETag to force a new
viewer document when the file is reopened.

```ts setup
import { versionedFileUrl } from "../../../src/frontend/src/hooks/useVersionedFileUrl.js";
```

```ts
versionedFileUrl("/test1/api/files/_content/report.pdf", 'W/"abc-123"')
=> /test1/api/files/_content/report.pdf?v=W%2F%22abc-123%22

versionedFileUrl("/test1/api/files/_content/report.pdf", null)
=> /test1/api/files/_content/report.pdf

versionedFileUrl("/test1/api/files/_content/report.pdf?download=1", 'W/"abc-123"')
=> /test1/api/files/_content/report.pdf?download=1&v=W%2F%22abc-123%22
```
