// # Which interrupted chats wake, and the claim that limits each wake
//
// `src/core/chat/session/interrupted-wake.ts` (docs/implemented-plans/interrupted-chat-wake.md).
// Records from earlier versions map by their cause; a claim refuses a record
// replaced since it was selected, so a stale selection cannot wake new work.

import { test } from "tap";
import assert from "node:assert/strict";
import "@ianbicking/tap-check/tap";
import { claimWake, wakeCandidates } from "../../../../src/core/chat/session/interrupted-wake.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

const at = "2026-11-02T20:00:00.000Z";
const record = (fields: Record<string, unknown>): string => JSON.stringify({ tasks: ["collect sources"], lastSeenAt: at, writer: "earlier-server", ...fields });

void test("candidates by cause, including records from earlier versions", async (t) => {
  const box = await makeTmpBox();
  t.teardown(async () => { await box.cleanup(); });
  const notes: Record<string, string> = {
    deploy: record({ at, cause: "box maintenance (deployment)", wake: true }),
    hung: record({ at, cause: "it had produced no output for 4 hours and was treated as hung", wake: false }),
    firstVersion: JSON.stringify({ at, reason: "deployment", tasks: ["collect sources"] }),
    shutdownBeforeWake: record({ at, cause: "the Bee Box server shut down" }),
    restartBeforeWake: record({ at, cause: "a restart was requested" }),
    crashed: record({}),
    alreadyWoken: record({ at, cause: "box maintenance (deployment)", wake: true, wokenAt: at }),
  };
  for (const [id, text] of Object.entries(notes)) await box.write(`.beebox/chat-run-ended/${id}.json`, text);
  t.check(wakeCandidates(box.root).map(({ sessionId, unstamped }) => ({ sessionId, unstamped })).toSorted((a, b) => a.sessionId.localeCompare(b.sessionId)), [
    { sessionId: "crashed", unstamped: true },
    { sessionId: "deploy", unstamped: false },
    { sessionId: "firstVersion", unstamped: false },
    { sessionId: "shutdownBeforeWake", unstamped: false },
  ]);
});

void test("a claim refuses a record replaced since selection, and counts against the daily limit", async (t) => {
  const box = await makeTmpBox();
  t.teardown(async () => { await box.cleanup(); });
  await box.write(".beebox/chat-run-ended/s1.json", record({ at, cause: "box maintenance (deployment)", wake: true }));
  const [candidate] = wakeCandidates(box.root);
  assert.ok(candidate);
  // The person's turn took the note and new work began before the claim.
  await box.write(".beebox/chat-run-ended/s1.json", record({ lastSeenAt: "2026-11-02T21:00:00.000Z", writer: "this-server" }));
  const now = new Date("2026-11-02T21:01:00.000Z");
  t.check(claimWake(box.root, { candidate, now, count: true }), false);

  await box.write(".beebox/chat-run-ended/s1.json", record({ at, cause: "box maintenance (deployment)", wake: true }));
  const [fresh] = wakeCandidates(box.root);
  assert.ok(fresh);
  t.check({ claimed: claimWake(box.root, { candidate: fresh, now, count: true }), log: JSON.parse(await box.read(".beebox/chat-wakes.json")) }, {
    claimed: true,
    log: { s1: ["2026-11-02T21:01:00.000Z"] },
  });
});
