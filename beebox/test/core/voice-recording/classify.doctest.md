# HQ error classification

`classifyHqError` sorts one HQ transcription attempt's failure into
`"transient"`, `"permanent"`, or `"piece-too-long"`, so the job knows whether
to retry with backoff, halve the piece and restart, or give up.

```ts setup
import { classifyHqError } from "../../../src/core/voice-recording/classify.js";
```

## No response at all (network error/timeout) is transient

```ts
classifyHqError({})
=> transient
```

## 429 is transient; other 4xx are permanent

```ts
classifyHqError({ status: 429 })
=> transient

classifyHqError({ status: 401 })
=> permanent

classifyHqError({ status: 403 })
=> permanent

classifyHqError({ status: 400 })
=> permanent
```

## 5xx is transient, except 501

```ts
classifyHqError({ status: 500 })
=> transient

classifyHqError({ status: 502 })
=> transient

classifyHqError({ status: 501 })
=> permanent
```

## 408 and 413 are piece-too-long regardless of body

```ts
classifyHqError({ status: 408 })
=> piece-too-long

classifyHqError({ status: 413 })
=> piece-too-long
```

## A 503 is piece-too-long only when the body names `diarization_unavailable`

This is MAI-Transcribe-2's documented too-long-to-diarize answer; an ordinary
503 (provider down) is transient so it gets retried instead of halved:

```ts
classifyHqError({ status: 503, body: JSON.stringify({ error: "diarization_unavailable" }) })
=> piece-too-long

classifyHqError({ status: 503 })
=> transient

classifyHqError({ status: 503, body: "Service Unavailable" })
=> transient
```

## A status-less error's own `permanent` flag decides it

`MissingOpenRouterKeyError` throws before any HTTP request happens — no
status, but its `TranscriptionError` shape carries `permanent: true`:

```ts
classifyHqError({ permanent: true })
=> permanent

classifyHqError({ permanent: false })
=> transient
```
