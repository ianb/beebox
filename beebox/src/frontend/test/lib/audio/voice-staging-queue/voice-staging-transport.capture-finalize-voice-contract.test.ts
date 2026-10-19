// # Voice finalize wire contract: client body ↔ server schema
//
// `buildVoiceFinalizeBody` (`voice-staging-transport.ts`) is the ONLY place the
// client assembles a finalize request body, and `VoiceFinalizeBodySchema`
// (`capture-finalize-voice.ts`) is the ONLY place the server parses one. This
// test wires the real client builder straight into the real server schema for
// every shape `PendingRecording.seal` can produce, so a change to one side that
// the other doesn't know about (e.g. the server requiring a field the client
// never learned to send) fails here instead of only in production.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { buildVoiceFinalizeBody } from "../../../../src/lib/audio/voice-staging-queue/voice-staging-transport.js";
import { VoiceFinalizeBodySchema } from "../../../../../webapp/routes/capture/finalize-voice.js";
import type { VoiceFinalizeOp } from "../../../../src/lib/audio/voice-staging-queue-core.js";

function parse(payload: VoiceFinalizeOp) {
  const body = buildVoiceFinalizeBody(payload);
  const result = VoiceFinalizeBodySchema.safeParse(body);
  return { body, ok: result.success, issues: result.success ? null : result.error.issues.map((i) => i.path.join(".")) };
}

// ## HQ send: `emissionId` and `hq.emissionId` both present
void test("HQ send: `emissionId` and `hq.emissionId` both present", async (t) => {
  const { body, ok } = parse({ kind: "finalize", chunkCount: 3, emissionId: "em-1", hq: { emissionId: "em-1", sessionId: "chat-1" } });
  t.check({ ok, body }, {
    ok: true,
    body: {
      chunkCount: 3,
      emissionId: "em-1",
      hq: {
        emissionId: "em-1",
        sessionId: "chat-1",
      },
    },
  });
});

// ## Non-HQ send: `emissionId` present, `hq` null
//
// A recording sealed without an HQ request (`get-last-audio` finds it by
// `emissionId` alone):
void test("A recording sealed without an HQ request (get-last-audio finds it by emission...", async (t) => {
  const { body, ok } = parse({ kind: "finalize", chunkCount: 2, emissionId: "em-2", hq: null });
  t.check({ ok, body }, {
    ok: true,
    body: {
      chunkCount: 2,
      emissionId: "em-2",
      hq: null,
    },
  });
});

// ## Unconsumed/cancel/unmount seal: both null
void test("Unconsumed/cancel/unmount seal: both null", async (t) => {
  const { body, ok } = parse({ kind: "finalize", chunkCount: 0, emissionId: null, hq: null });
  t.check({ ok, body }, {
    ok: true,
    body: {
      chunkCount: 0,
      emissionId: null,
      hq: null,
    },
  });
});

// ## A body missing `emissionId` entirely is rejected
//
// Guards against exactly the drift this test exists to catch: a client that
// still doesn't send the field the server now requires.
void test("Guards against exactly the drift this test exists to catch:", async (t) => {
  const result = VoiceFinalizeBodySchema.safeParse({ chunkCount: 1, hq: null });
  t.check(result.success, false);
});
