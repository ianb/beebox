# Capture upload failure classification

`classifyUploadFailure` decides what a failed upload attempt means: give up
quietly (the user cancelled), try again, or stop because retrying would repeat
the same rejection.

This is the policy that made a whole capture fail in the field. The old client
put a fixed 30-second `AbortSignal.timeout` on every request, so a
full-resolution photo on a weak uplink aborted mid-transfer, retried from byte
zero, and re-spent the same scarce bandwidth until its retries ran out — while
five sibling uploads did the same thing on the same link. The transport now
aborts only on a *stall* (no bytes moving), so "slow" and "stuck" are different
outcomes, and only the latter reaches this function.

```ts setup
import { classifyUploadFailure } from "../../src/frontend/src/pages/capture/capture-api.js";
import {
  UploadAbortedError,
  UploadStalledError,
  UploadNetworkError,
  UploadResponseError,
} from "../../src/frontend/src/lib/binary-upload.js";

const status = (code) => new UploadResponseError({ status: code, detail: "nope" });
```

## A cancel is not a failure

The user pressed "Skip them" on a pending Done, or cancelled capture outright.
Retrying would defeat the very cancel it came from:

```ts
classifyUploadFailure(new UploadAbortedError())
=> abort
```

## Stalls and transport faults are worth another go

A stalled transfer means no bytes moved for the stall window — the link may
well recover, so try again:

```ts
classifyUploadFailure(new UploadStalledError(20_000))
=> retry

classifyUploadFailure(new UploadNetworkError())
=> retry
```

An unrecognized error is treated as transient rather than fatal: a spurious
extra attempt costs one upload, while wrongly giving up loses a photo:

```ts
classifyUploadFailure(new Error("something unexpected"))
=> retry
```

## Server errors retry; client errors don't

5xx is the server having a bad moment, and 408/429 are it explicitly asking us
to come back:

```ts
[500, 502, 503, 408, 429].map((c) => classifyUploadFailure(status(c))).join(",")
=> retry,retry,retry,retry,retry
```

Every other 4xx is this request being wrong on its merits — a bad filename, a
session that is no longer open, a size cap. Retrying repeats it verbatim, so
the upload is failed immediately and surfaces to the user:

```ts
[400, 401, 403, 404, 409, 413].map((c) => classifyUploadFailure(status(c))).join(",")
=> fatal,fatal,fatal,fatal,fatal,fatal
```

A 409 is the case worth naming: the staging session was sealed (someone pressed
Done) or the audio format changed mid-segment. Both are settled facts, not
transient conditions.

```ts
classifyUploadFailure(status(409))
=> fatal
```
