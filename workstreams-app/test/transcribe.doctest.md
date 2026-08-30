# Transcribing a spoken comment (src/server/transcribe-contract.ts)

Two steps, not one: this returns **text and nothing else**, and the client puts
it in the composer where it can be edited before anything is stored
(`docs/plans/document-comments.md`, Track 4). That is why the audio only has to
survive until the transcript returns — after that the comment is text like any
other, with nothing left to lose.

Every failure here leaves the recording in the page, so each one is a distinct
class with a message that says what to do next rather than only what went wrong.

```ts setup
import assert from "node:assert/strict";

import {
  MAX_AUDIO_BYTES,
  TranscriptionNotConfiguredError,
  TranscriptionRefusedError,
  TranscriptionShapeError,
  transcribeInputSchema,
} from "../src/server/transcribe-contract.js";
import { createFakeTranscribeService } from "../src/server/transcribe-openai.js";
```

## The input carries audio and a container hint

`mimeType` defaults rather than being required: a browser that reports nothing
useful still gets a transcription attempt.

```ts
const parsed = transcribeInputSchema.parse({ audio: "AAAA" });
JSON.stringify(parsed)
=> {"audio":"AAAA","mimeType":"audio/webm"}
```

Empty audio is refused at the boundary rather than sent to a paid endpoint.

```ts continue
JSON.stringify(transcribeInputSchema.safeParse({ audio: "" }).success)
=> false
```

## The cap is in bytes, and it is under the wire limit

A duration cap is not a byte guarantee — the app inherits Fastify's 1 MiB body
limit, and base64 inflates by about a third. The cap has to leave room for that.

```ts
const inflated = MAX_AUDIO_BYTES * (4 / 3);
JSON.stringify({ capBytes: MAX_AUDIO_BYTES, base64FitsUnder1MiB: inflated < 1024 * 1024 })
=> {"capBytes":700000,"base64FitsUnder1MiB":true}
```

## Each failure is its own class, with an actionable message

Three different things went wrong and three different things should happen next:
configure a key, retry, or report a broken upstream.

```ts
const failures = [
  new TranscriptionNotConfiguredError(),
  new TranscriptionRefusedError(503, "upstream busy"),
  new TranscriptionShapeError(),
];
JSON.stringify(failures.map((error) => error.name))
=> ["TranscriptionNotConfiguredError","TranscriptionRefusedError","TranscriptionShapeError"]
```

The not-configured message names the variable AND the way out, because the
person reading it is mid-thought with a recording they cannot send.

```ts continue
const notConfigured = new TranscriptionNotConfiguredError();
JSON.stringify({
  namesTheVariable: notConfigured.message.includes("BBX_OPENAI_API_KEY"),
  offersAWayOut: notConfigured.message.includes("type it instead"),
})
=> {"namesTheVariable":true,"offersAWayOut":true}
```

A refusal keeps the status for a report, and still tells the boxholder the
recording survived.

```ts continue
const refused = new TranscriptionRefusedError(429, "rate limited");
JSON.stringify({
  status: refused.status,
  detail: refused.detail,
  saysRecordingSurvived: refused.message.includes("still here"),
})
=> {"status":429,"detail":"rate limited","saysRecordingSurvived":true}
```

## The service is a seam, so the route is testable without a key

The fake is the reason a doctest can drive this at all — there is no way to
force a canned transcript through a real HTTP call.

```ts
const fake = createFakeTranscribeService("the router does not restart here");
const result = await fake.transcribe({ audio: Buffer.from([1, 2, 3]), mimeType: "audio/webm" });
assert.equal(result.text, "the router does not restart here");
result.text
=> the router does not restart here
```
