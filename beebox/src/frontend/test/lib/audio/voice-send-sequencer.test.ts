// # Voice sends dispatch in segment order
//
// `voice-send-sequencer.ts` (`docs/plans/resilient-voice-recording.md`,
// Track 4): each voice segment reserves a slot when it ends, and its dispatch
// waits until every earlier slot is released. The HQ waits behind the slots run
// concurrently, so a later segment's fast HQ result waits for an earlier
// segment's slow one instead of overtaking it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createVoiceSendSequencer } from "../../../src/lib/audio/voice-send-sequencer.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ## A later segment that finishes first still dispatches second
void test("A later segment that finishes first still dispatches second", async (t) => {
  // doctest:L18
  const sequencer = createVoiceSendSequencer();
  const dispatched: string[] = [];
  const first = sequencer.reserve();
  const second = sequencer.reserve();

  // doctest:L23
  // Segment 2's HQ is ready at once; segment 1's is still retrying.
  const secondDone = second.turn().then(() => { dispatched.push("segment 2"); second.release(); });
  await tick();
  t.check(dispatched.join(","), "");

  // doctest:L29
  await first.turn();
  dispatched.push("segment 1");
  first.release();
  await secondDone;
  t.check(dispatched.join(","), "segment 1,segment 2");
});

// ## A slot that gives up still lets the next one through
//
// An early exit (nothing to send, a refused capture) releases without
// dispatching; a release is idempotent.
void test("An early exit (nothing to send, a refused capture) releases without dispatchi...", async (t) => {
  // doctest:L43
  const sequencer = createVoiceSendSequencer();
  const abandoned = sequencer.reserve();
  const next = sequencer.reserve();
  abandoned.release();
  abandoned.release();
  let reached = false;
  await next.turn().then(() => { reached = true; });
  t.check(reached, true);
});
