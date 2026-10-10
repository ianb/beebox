# Finishing a voice send a reload interrupted during its HQ wait

A reload keeps a voice send that was waiting for its HQ transcript as an
`awaitingHq` row (`pending-sends.ts`); it is never sent on its own
(`docs/plans/resilient-voice-recording.md`, Track 4). `resolveAwaitingHq`
turns the user's choice into the emission to dispatch through the row's
original destination. These examples use a fake box for `claim`/`fallBack`.

```ts setup
import { resolveAwaitingHq } from "../../../../../src/components/chat/conversation/use-bound-emission/awaiting-hq.js";

const READY = { text: "clean words", diarized: false, service: "mai", pieces: 1 };
const inSession = { boxSlug: "test", target: { kind: "session", sessionId: "chat-1", contextDir: "" }, attention: { surface: "chat", transcript: "visible" } };

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
      fallBack: async () => { calls.push("fallBack"); return replies.fallBack; },
    },
  };
}
```

## "Send HQ transcript" claims the result; the send keyword is restored

The saved realtime text ended with the spoken "send message" tag; the HQ text
gets the same tag back, marked `heard="live"` because the HQ text did not
reproduce it.

```ts
const { box, calls } = fakeBox({ claim: { outcome: "claimed", result: READY } });
const r = await resolveAwaitingHq({ row: row(inSession, "rough wordz <send-message phrase=\"send message\" />"), recordingId: "rec-1", choice: "hq", box });
JSON.stringify({ kind: r.kind, text: r.emission.text, hqText: r.emission.hqText, id: r.emission.id, calls })
=> {"kind":"send","text":"clean words <send-message phrase=\"send message\" heard=\"live\" />","hqText":true,"id":"em-1","calls":["claim"]}
```

If the result is not ready after all, nothing is sent:

```ts
const { box } = fakeBox({ claim: { outcome: "pending", hq: { state: "transcribing", piece: 1, pieces: 2, attempt: 1, pieceSeconds: 300 } } });
(await resolveAwaitingHq({ row: row(inSession, "rough"), recordingId: "rec-1", choice: "hq", box })).kind
=> not-ready
```

## "Send live text" falls back; HQ that is already ready wins

The fallback is the realtime emission unchanged — no `hqText`, so the
assembler marks it `stt="live"`.

```ts
const { box, calls } = fakeBox({ fallBack: { outcome: "fellBack" } });
const r = await resolveAwaitingHq({ row: row(inSession, "rough words"), recordingId: "rec-1", choice: "live", box });
JSON.stringify({ text: r.emission.text, hqText: r.emission.hqText ?? null, calls })
=> {"text":"rough words","hqText":null,"calls":["fallBack"]}

const won = fakeBox({ fallBack: { outcome: "claimed", result: READY } });
(await resolveAwaitingHq({ row: row(inSession, "rough words"), recordingId: "rec-1", choice: "live", box: won.box })).emission.text
=> clean words
```
