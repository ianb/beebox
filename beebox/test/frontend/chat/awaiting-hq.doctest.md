# Finishing a voice send a reload interrupted during its HQ wait

A reload keeps a voice send that was waiting for its HQ transcript as an
`awaitingHq` row (`pending-sends.ts`); it is never sent on its own
(`docs/plans/resilient-voice-recording.md`, Track 4). `resolveAwaitingHq`
turns the user's choice into the emission to dispatch through the row's
original destination. These examples use a fake box for `claim`/`fallBack`.

```ts setup
import { resolveAwaitingHq } from "../../../src/frontend/src/components/chat/conversation/awaiting-hq.js";

const READY = { text: "clean words", diarized: false, service: "mai", pieces: 1 };
const inSession = { boxSlug: "test", target: { kind: "session", sessionId: "chat-1", contextDir: "" }, attention: { surface: "chat", transcript: "visible" } };
const newChat = { boxSlug: "test", target: { kind: "start", clientConversationId: "c-1", contextDir: "", seedFeatures: {} }, attention: { surface: "chat", transcript: "visible" } };

function row(binding: unknown, text: string) {
  return {
    emission: { id: "em-1", origin: "voice", text, images: [], files: [], selections: [], diarized: false, spokenStart: 0 },
    binding, status: "awaitingHq", recordingId: "rec-1",
  };
}

function fakeBox(replies: { claim?: unknown; fallBack?: unknown }) {
  const calls: string[] = [];
  return {
    calls,
    box: {
      claim: async () => { calls.push("claim"); return replies.claim; },
      fallBack: async (input: { sessionId: string }) => { calls.push(`fallBack ${input.sessionId}`); return replies.fallBack; },
    },
  };
}
```

## "Send HQ transcript" claims the result; the send keyword is restored

The saved realtime text ended with the spoken "send message" tag; the HQ text
gets the same tag back.

```ts
const { box, calls } = fakeBox({ claim: { outcome: "claimed", result: READY } });
const r = await resolveAwaitingHq({ row: row(inSession, "rough wordz <send-message phrase=\"send message\" />"), recordingId: "rec-1", choice: "hq", box });
JSON.stringify({ kind: r.kind, text: r.emission.text, hqText: r.emission.hqText, id: r.emission.id, recordLate: r.recordLate, calls })
=> {"kind":"send","text":"clean words <send-message phrase=\"send message\" />","hqText":true,"id":"em-1","recordLate":false,"calls":["claim"]}
```

If the result is not ready after all, nothing is sent:

```ts
const { box } = fakeBox({ claim: { outcome: "pending", hq: { state: "transcribing", piece: 1, pieces: 2, attempt: 1, pieceSeconds: 300 } } });
(await resolveAwaitingHq({ row: row(inSession, "rough"), recordingId: "rec-1", choice: "hq", box })).kind
=> not-ready
```

## "Send live text" falls back; HQ that is already ready wins

```ts
const { box, calls } = fakeBox({ fallBack: { outcome: "late" } });
const r = await resolveAwaitingHq({ row: row(inSession, "rough words"), recordingId: "rec-1", choice: "live", box });
JSON.stringify({ text: r.emission.text, hqFallback: r.emission.hqFallback, recordLate: r.recordLate, calls })
=> {"text":"rough words","hqFallback":"pending","recordLate":false,"calls":["fallBack chat-1"]}

const won = fakeBox({ fallBack: { outcome: "claimed", result: READY } });
(await resolveAwaitingHq({ row: row(inSession, "rough words"), recordingId: "rec-1", choice: "live", box: won.box })).emission.text
=> clean words
```

A new chat had no session when the row was saved: the live text goes out
first and the fallback is recorded after the send (`recordLate`).

```ts
const { box, calls } = fakeBox({});
const r = await resolveAwaitingHq({ row: row(newChat, "rough words"), recordingId: "rec-1", choice: "live", box });
JSON.stringify({ hqFallback: r.emission.hqFallback, recordLate: r.recordLate, calls })
=> {"hqFallback":"pending","recordLate":true,"calls":[]}
```
