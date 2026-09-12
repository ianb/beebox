# Upstream error-body truncation

Every HQ transcription arm stores the provider's error body on its
`TranscriptionError` so the job can classify the failure without re-reading a
consumed response stream. `truncateUpstreamBody` bounds what gets carried:
enough to read the provider's reason, not enough to dump megabytes into a
manifest.

It lives in its own leaf module rather than the `transcription/index.js`
barrel, which imports the arms — importing it back from the barrel was this
directory's only *value* import cycle.

```ts setup
import { truncateUpstreamBody } from "../../src/core/transcription/upstream-body.js";
```

## Short bodies pass through unchanged

```ts
truncateUpstreamBody("model unavailable")
=> model unavailable

truncateUpstreamBody("")
=>
```

## Long bodies are cut to 500 characters

A 600-character body keeps its first 500 characters and nothing else — no
ellipsis, no suffix, so the result is a strict prefix of the original.

```ts
const long = "x".repeat(600);
truncateUpstreamBody(long).length
=> 500

long.startsWith(truncateUpstreamBody(long))
=> true
```

Exactly 500 is not truncated; 501 is.

```ts
truncateUpstreamBody("y".repeat(500)).length
=> 500

truncateUpstreamBody("y".repeat(501)).length
=> 500
```
