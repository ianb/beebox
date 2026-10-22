// # Voice recording GC sweep
//
// `sweepVoiceSessions` (`docs/plans/resilient-voice-recording.md`, Track 1)
// deletes a voice session's staging directory 7 days after creation if it was
// never sealed, 7 days after it reaches a terminal handoff/HQ state, or 7 days
// after sealing if it never becomes terminal.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import type { TmpBox } from "../../helpers/test-helpers.js";
import type { StagingSession, StagingVoice } from "../../../src/core/capture/staging-schema.js";
import { invariant } from "../../../src/shared/invariant.js";
import { createStagingSession, readStagingSession, writeStagingSession } from "../../../src/core/capture/staging-store/core.js";
import { sealVoiceSession, applyVoiceEvent } from "../../../src/core/voice-recording/voice-staging/core.js";
import { sweepVoiceSessions } from "../../../src/core/voice-recording/sweep.js";

async function configureBox(box: TmpBox) {
  await box.write(".gitignore", ["_tmp/", ".beebox/"].join("\n") + "\n");
  box.commitAll("configure");
}

// Directly backdate a timestamp field on the manifest, bypassing getBoxTimeISO
// — the sweep's retention math is a plain wall-clock diff against whatever's
// on disk, so this is the simplest way to make a session "old" in a test.
async function backdate(box: TmpBox, { id, ...patch }: { id: string; session?: Partial<StagingSession>; voice?: Partial<StagingVoice> }) {
  const session = await readStagingSession({ boxRoot: box.root, id });
  invariant(session?.voice, "staged voice recording exists");
  Object.assign(session, patch.session || {});
  Object.assign(session.voice, patch.voice || {});
  await writeStagingSession({ boxRoot: box.root, session });
}

const EIGHT_DAYS_AGO = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
const SIX_DAYS_AGO = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

// ## An open, never-sealed recording is GC'd after 7 days — not before
void test("An open, never-sealed recording is GC'd after 7 days — not before", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await configureBox(box);

  const stale = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null, kind: "voice" });
  await backdate(box, { id: stale.id, session: { createdAt: EIGHT_DAYS_AGO } });

  const fresh = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null, kind: "voice" });
  await backdate(box, { id: fresh.id, session: { createdAt: SIX_DAYS_AGO } });

  const result = await sweepVoiceSessions({ boxRoot: box.root });
  t.check(result.deleted, [
    str`${any(String)}`,
  ]);

  t.check(
    {
      deletedWasStale: result.deleted[0] === stale.id,
      staleGone: (await readStagingSession({ boxRoot: box.root, id: stale.id })) === null,
      freshStillThere: (await readStagingSession({ boxRoot: box.root, id: fresh.id })) !== null,
    },
    {
    deletedWasStale: true,
    staleGone: true,
    freshStillThere: true,
  },
  );
});

// ## A sealed recording with no HQ requested is terminal immediately, GC'd 7 days later
void test("A sealed recording with no HQ requested is terminal immediately, GC'd 7 days later", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await configureBox(box);

  const session = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null, kind: "voice" });
  await sealVoiceSession({ boxRoot: box.root, id: session.id, emissionId: null, hq: null });

  const sealed = await readStagingSession({ boxRoot: box.root, id: session.id });
  invariant(sealed?.voice, "sealed recording keeps its voice state");
  t.check({ sealedAt: sealed.voice.sealedAt === sealed.voice.terminalAt, terminalAtSet: sealed.voice.terminalAt !== undefined }, {
    sealedAt: true,
    terminalAtSet: true,
  });

  await backdate(box, { id: session.id, voice: { terminalAt: EIGHT_DAYS_AGO } });
  const result = await sweepVoiceSessions({ boxRoot: box.root });
  t.check(
    {
      deletedThisOne: result.deleted[0] === session.id && result.deleted.length === 1,
      gone: (await readStagingSession({ boxRoot: box.root, id: session.id })) === null,
    },
    {
    deletedThisOne: true,
    gone: true,
  },
  );
});

// ## A fallback is terminal, whatever the HQ pass does afterwards
//
// The client sent realtime text (`fellBack`); an HQ result that arrives later
// stays on the box until retention, and does not reset `terminalAt`:
void test("The client sent realtime text (fellBack); an HQ result that arrives later sta...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await configureBox(box);

  const session = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null, kind: "voice" });
  await sealVoiceSession({
    boxRoot: box.root, id: session.id, emissionId: "e1",
    hq: { emissionId: "e1", sessionId: "chat-1", service: "whisper", requestedAt: "2026-09-10T18:00:00.000Z" },
  });
  await applyVoiceEvent({ boxRoot: box.root, id: session.id, event: { type: "fallBackRequested", emissionId: "e1" } });
  await backdate(box, { id: session.id, voice: { terminalAt: EIGHT_DAYS_AGO } });
  await applyVoiceEvent({
    boxRoot: box.root, id: session.id,
    event: { type: "allPiecesDone", result: { text: "hi", diarized: false, service: "whisper", pieces: 1 } },
  });

  const result = await sweepVoiceSessions({ boxRoot: box.root });
  t.check(
    {
      deletedThisOne: result.deleted[0] === session.id && result.deleted.length === 1,
      gone: (await readStagingSession({ boxRoot: box.root, id: session.id })) === null,
    },
    {
    deletedThisOne: true,
    gone: true,
  },
  );
});

// ## A sealed recording that never becomes terminal is GC'd 7 days after sealing
//
// The tab closed during the HQ wait: HQ finished (`ready`) but no client ever
// claimed or fell back, so the handoff stays `open` and `terminalAt` is never
// set. Retention counts from `sealedAt` instead — not before 7 days:
void test("The tab closed during the HQ wait:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await configureBox(box);

  async function sealedReadyUnclaimed(sealedAt: string) {
    const session = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null, kind: "voice" });
    await sealVoiceSession({
      boxRoot: box.root, id: session.id, emissionId: `e-${session.id}`,
      hq: { emissionId: `e-${session.id}`, sessionId: "chat-1", service: "whisper", requestedAt: "2026-09-10T18:00:00.000Z" },
    });
    await applyVoiceEvent({
      boxRoot: box.root, id: session.id,
      event: { type: "allPiecesDone", result: { text: "hi", diarized: false, service: "whisper", pieces: 1 } },
    });
    await backdate(box, { id: session.id, voice: { sealedAt } });
    return session;
  }
  const stale = await sealedReadyUnclaimed(EIGHT_DAYS_AGO);
  const fresh = await sealedReadyUnclaimed(SIX_DAYS_AGO);

  const staleSession = await readStagingSession({ boxRoot: box.root, id: stale.id });
  invariant(staleSession?.voice, "stale recording keeps its voice state");
  const staleVoice = staleSession.voice;
  t.check({ handoff: staleVoice.handoff.mode, hq: staleVoice.hq.state, terminalAt: staleVoice.terminalAt ?? null }, {
    handoff: "open",
    hq: "ready",
    terminalAt: null,
  });

  const result = await sweepVoiceSessions({ boxRoot: box.root });
  t.check(
    {
      deletedOnlyStale: result.deleted.length === 1 && result.deleted[0] === stale.id,
      freshStillThere: (await readStagingSession({ boxRoot: box.root, id: fresh.id })) !== null,
    },
    {
    deletedOnlyStale: true,
    freshStillThere: true,
  },
  );
});
