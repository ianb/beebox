# Voice finalize wire contract: client body ↔ server schema

`buildVoiceFinalizeBody` (`voice-staging-transport.ts`) is the ONLY place the
client assembles a finalize request body, and `VoiceFinalizeBodySchema`
(`capture-finalize-voice.ts`) is the ONLY place the server parses one. This
test wires the real client builder straight into the real server schema for
every shape `PendingRecording.seal` can produce, so a change to one side that
the other doesn't know about (e.g. the server requiring a field the client
never learned to send) fails here instead of only in production.

```ts setup
import { buildVoiceFinalizeBody } from "../../../src/frontend/src/lib/audio/voice-staging-transport.js";
import { VoiceFinalizeBodySchema } from "../../../src/webapp/routes/capture-finalize-voice.js";
import type { VoiceFinalizeOp } from "../../../src/frontend/src/lib/audio/voice-staging-queue-core.js";

function parse(payload: VoiceFinalizeOp) {
  const body = buildVoiceFinalizeBody(payload);
  const result = VoiceFinalizeBodySchema.safeParse(body);
  return { body, ok: result.success, issues: result.success ? null : result.error.issues.map((i) => i.path.join(".")) };
}
```

## HQ send: `emissionId` and `hq.emissionId` both present

```ts
const { body, ok } = parse({ kind: "finalize", chunkCount: 3, emissionId: "em-1", hq: { emissionId: "em-1", sessionId: "chat-1" } });
JSON.stringify({ ok, body })
=> {"ok":true,"body":{"chunkCount":3,"emissionId":"em-1","hq":{"emissionId":"em-1","sessionId":"chat-1"}}}
```

## Non-HQ send: `emissionId` present, `hq` null

The HQ-dictation-off case this fix restores (`get-last-audio` finds the
recording by `emissionId` alone):

```ts
const { body, ok } = parse({ kind: "finalize", chunkCount: 2, emissionId: "em-2", hq: null });
JSON.stringify({ ok, body })
=> {"ok":true,"body":{"chunkCount":2,"emissionId":"em-2","hq":null}}
```

## Unconsumed/cancel/unmount seal: both null

```ts
const { body, ok } = parse({ kind: "finalize", chunkCount: 0, emissionId: null, hq: null });
JSON.stringify({ ok, body })
=> {"ok":true,"body":{"chunkCount":0,"emissionId":null,"hq":null}}
```

## A body missing `emissionId` entirely is rejected

Guards against exactly the drift this test exists to catch: a client that
still doesn't send the field the server now requires.

```ts
const result = VoiceFinalizeBodySchema.safeParse({ chunkCount: 1, hq: null });
result.success
=> false
```
