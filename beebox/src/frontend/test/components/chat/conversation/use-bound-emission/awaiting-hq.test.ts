// # Finishing a voice send a reload interrupted during its HQ wait
//
// A reload keeps a voice send that was waiting for its HQ transcript as an
// `awaitingHq` row (`pending-sends.ts`); it is never sent on its own
// (`docs/plans/resilient-voice-recording.md`, Track 4). `resolveAwaitingHq`
// turns the user's choice into the emission to dispatch through the row's
// original destination. These examples use a fake box for `claim`/`fallBack`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import assert from "node:assert/strict";
import { resolveAwaitingHq, type AwaitingHqResolution } from "../../../../../src/components/chat/conversation/use-bound-emission/awaiting-hq.js";
import type { PendingConversationSend } from "../../../../../src/components/chat/conversation/use-bound-emission/pending-sends.js";
import type { HqWaitDeps, VoiceHqResult } from "../../../../../src/lib/audio/hq-wait.js";
import type { Emission } from "../../../../../src/input/emission.js";
import type { SendBinding } from "../../../../../../shared/chat-composer-binding.js";

type Claim = Awaited<ReturnType<HqWaitDeps["claim"]>>;
type FallBack = Awaited<ReturnType<HqWaitDeps["fallBack"]>>;

const READY: VoiceHqResult = { text: "clean words", diarized: false, service: "mai", pieces: 1 };
const inSession: SendBinding = { boxSlug: "test", target: { kind: "session", sessionId: "chat-1", contextDir: "" }, attention: { surface: "chat", transcript: "visible" } };

function row(binding: SendBinding, text: string): PendingConversationSend {
  return {
    emission: { id: "em-1", origin: "voice", text, images: [], files: [], selections: [], diarized: false, spokenStart: 0 },
    binding, status: "awaitingHq", recordingId: "rec-1",
  };
}

/** The emission of a resolution that sends. */
function sent(resolution: AwaitingHqResolution): Emission {
  assert.ok(resolution.kind === "send");
  return resolution.emission;
}

function reply<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`fake box has no ${name} reply`);
  return value;
}

function fakeBox(replies: { claim?: Claim; fallBack?: FallBack }) {
  const calls: string[] = [];
  return {
    calls,
    box: {
      claim: async () => { calls.push("claim"); return reply(replies.claim, "claim"); },
      fallBack: async () => { calls.push("fallBack"); return reply(replies.fallBack, "fallBack"); },
    },
  };
}

// ## "Send HQ transcript" claims the result; the send keyword is restored
//
// The saved realtime text ended with the spoken "send message" tag; the HQ text
// gets the same tag back, marked `heard="live"` because the HQ text did not
// reproduce it.
void test("The saved realtime text ended with the spoken \"send message\" tag; the HQ text...", async (t) => {
  // doctest:L60
  const { box, calls } = fakeBox({ claim: { outcome: "claimed", result: READY } });
  const r = await resolveAwaitingHq({ row: row(inSession, "rough wordz <send-message phrase=\"send message\" />"), recordingId: "rec-1", choice: "hq", box });
  t.check({ kind: r.kind, text: sent(r).text, hqText: sent(r).hqText, id: sent(r).id, calls }, {
    kind: "send",
    text: "clean words <send-message phrase=\"send message\" heard=\"live\" />",
    hqText: true,
    id: "em-1",
    calls: [
      "claim",
    ],
  });
});

// If the result is not ready after all, nothing is sent:
void test("If the result is not ready after all, nothing is sent:", async (t) => {
  // doctest:L69
  const { box } = fakeBox({ claim: { outcome: "pending", hq: { state: "transcribing", piece: 1, pieces: 2, attempt: 1, pieceSeconds: 300 } } });
  t.check((await resolveAwaitingHq({ row: row(inSession, "rough"), recordingId: "rec-1", choice: "hq", box })).kind, "not-ready");
});

// ## "Send live text" falls back; HQ that is already ready wins
//
// The fallback is the realtime emission unchanged — no `hqText`, so the
// assembler marks it `stt="live"`.
void test("The fallback is the realtime emission unchanged — no hqText, so the assembler...", async (t) => {
  // doctest:L80
  const { box, calls } = fakeBox({ fallBack: { outcome: "fellBack" } });
  const r = await resolveAwaitingHq({ row: row(inSession, "rough words"), recordingId: "rec-1", choice: "live", box });
  t.check({ text: sent(r).text, hqText: sent(r).hqText ?? null, calls }, {
    text: "rough words",
    hqText: null,
    calls: [
      "fallBack",
    ],
  });

  // doctest:L85
  const won = fakeBox({ fallBack: { outcome: "claimed", result: READY } });
  t.check(sent(await resolveAwaitingHq({ row: row(inSession, "rough words"), recordingId: "rec-1", choice: "live", box: won.box })).text, "clean words");
});
