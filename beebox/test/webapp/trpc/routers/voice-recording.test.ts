// # `voiceRecording` tRPC procedures: status, claim, fallBack
//
// The client half of the voice-recording handoff
// (`docs/plans/resilient-voice-recording.md`, Track 1). `status` is read-only
// ground truth for the pending bubble; `claim`/`fallBack`
// apply one event through the same `nextVoiceState` machine the HQ job and
// finalize route already drive — this router adds no side effect beyond that one
// write, and both mutations are idempotent by `(recordingId, emissionId)`.

import { test } from "tap";
import "agent-doctest/tap";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import type { TrpcContext, TrpcUser } from "../../../../src/webapp/trpc/context.js";
import type { HqTranscriptionService } from "../../../../src/shared/transcription-services.js";
import { makeTmpBox, type TmpBox } from "../../../helpers/doctest-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { createEventBus } from "../../../../src/core/event-bus/core.js";
import { createStagingSession } from "../../../../src/core/capture/staging-store/core.js";
import { sealVoiceSession, applyVoiceEvent } from "../../../../src/core/voice-recording/voice-staging/core.js";

function caller(box: TmpBox, opts?: { user?: TrpcUser }) {
  const ctx: TrpcContext = trpcContext({
    boxRoot: box.root,
    eventBus: createEventBus(box.root),
    user: (opts && opts.user) || { email: "owner@example.com", name: "Owner" },
    isAuthenticatedOwner: true,
  });
  return appRouter.createCaller(ctx);
}

// The error code of a rejected call, or "no error".
function codeOf(e: unknown): string {
  return e instanceof TRPCError ? e.code : String(e);
}

async function stageVoiceRecording(box: TmpBox, { targetSessionId, createdBy }: { targetSessionId: string; createdBy?: string }) {
  return createStagingSession({
    boxRoot: box.root, targetSessionId, createdBy: createdBy ?? "owner@example.com", kind: "voice",
  });
}

async function requestHq({ box, session, emissionId, service, requestedAt }: {
  box: TmpBox;
  session: Awaited<ReturnType<typeof stageVoiceRecording>>;
  emissionId: string;
  service?: HqTranscriptionService;
  requestedAt?: string;
}) {
  return sealVoiceSession({
    boxRoot: box.root, id: session.id, emissionId,
    hq: {
      emissionId, sessionId: session.voice?.targetSessionId ?? null,
      service: service ?? "whisper", requestedAt: requestedAt ?? "2026-09-10T18:00:00.000Z",
    },
  });
}

const READY_RESULT = { text: "hello world", diarized: false, service: "whisper", pieces: 1 };

// ## claim before ready is `pending`; after ready it is `claimed` and idempotent
void test("claim before ready is `pending`; after ready it is `claimed` and idempotent", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L62
  const box = await makeTmpBox({ git: true });
  const session = await stageVoiceRecording(box, { targetSessionId: "chat-1" });
  await requestHq({ box, session, emissionId: "em-1" });
  const c = caller(box);

  // doctest:L67
  t.check(await c.voiceRecording.claim({ recordingId: session.id, emissionId: "em-1" }), {
    outcome: "pending",
    hq: {
      state: "queued",
    },
  });

  // doctest:L72
  await applyVoiceEvent({
    boxRoot: box.root, id: session.id,
    event: { type: "allPiecesDone", result: READY_RESULT },
  });

  // doctest:L77
  const claimed = await c.voiceRecording.claim({ recordingId: session.id, emissionId: "em-1" });
  t.check(claimed, {
    outcome: "claimed",
    result: {
      text: "hello world",
      diarized: false,
      service: "whisper",
      pieces: 1,
    },
  });

  // doctest:L81
  await t.checkText(
    // Idempotent repeat — same call again, same outcome, no error.
    JSON.stringify(await c.voiceRecording.claim({ recordingId: session.id, emissionId: "em-1" })),
    "{\"outcome\":\"claimed\",\"result\":{\"text\":\"hello world\",\"diarized\":false,\"service\":\"whisper\",\"pieces\":1}}",
  );
});

// ## fallBack before ready is `fellBack`; after ready HQ wins with `claimed`
void test("fallBack before ready is `fellBack`; after ready HQ wins with `claimed`", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L93
  const box = await makeTmpBox({ git: true });
  const fellBack = await stageVoiceRecording(box, { targetSessionId: "chat-1" });
  await requestHq({ box, session: fellBack, emissionId: "em-live" });
  const c = caller(box);

  // doctest:L98
  t.check(await c.voiceRecording.fallBack({ recordingId: fellBack.id, emissionId: "em-live" }), {
    outcome: "fellBack",
  });

  // doctest:L101
  // Idempotent repeat (a lost response, retried) — even after HQ finishes.
  await applyVoiceEvent({
    boxRoot: box.root, id: fellBack.id,
    event: { type: "allPiecesDone", result: READY_RESULT },
  });
  t.check(await c.voiceRecording.fallBack({ recordingId: fellBack.id, emissionId: "em-live" }), {
    outcome: "fellBack",
  });

  // doctest:L111
  const wonByHq = await stageVoiceRecording(box, { targetSessionId: "chat-1" });
  await requestHq({ box, session: wonByHq, emissionId: "em-won" });
  await applyVoiceEvent({
    boxRoot: box.root, id: wonByHq.id,
    event: { type: "allPiecesDone", result: READY_RESULT },
  });

  // doctest:L118
  t.check(await c.voiceRecording.fallBack({ recordingId: wonByHq.id, emissionId: "em-won" }), {
    outcome: "claimed",
    result: {
      text: "hello world",
      diarized: false,
      service: "whisper",
      pieces: 1,
    },
  });
});

// ## fallBack after a terminal HQ failure reports `failed`
void test("fallBack after a terminal HQ failure reports `failed`", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L129
  const box = await makeTmpBox({ git: true });
  const session = await stageVoiceRecording(box, { targetSessionId: "chat-1" });
  await requestHq({ box, session, emissionId: "em-1" });
  await applyVoiceEvent({
    boxRoot: box.root, id: session.id,
    event: {
      type: "pieceFailed", classification: "permanent", pieceSeconds: 300, attempt: 1,
      nextAttemptAt: "2026-09-10T18:00:00.000Z",
      failure: { code: "http_401", message: "missing key" },
    },
  });
  const c = caller(box);

  // doctest:L142
  t.check(await c.voiceRecording.fallBack({ recordingId: session.id, emissionId: "em-1" }), {
    outcome: "failed",
    failure: {
      kind: "permanent",
      code: "http_401",
      message: "missing key",
    },
  });
});

// ## A mismatched emission id is a CONFLICT, never a silent no-op
void test("A mismatched emission id is a CONFLICT, never a silent no-op", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L153
  const box = await makeTmpBox({ git: true });
  const session = await stageVoiceRecording(box, { targetSessionId: "chat-1" });
  await requestHq({ box, session, emissionId: "em-1" });
  const c = caller(box);

  // doctest:L158
  t.check(await c.voiceRecording.claim({ recordingId: session.id, emissionId: "wrong-emission" }).then(() => "no error", codeOf), "CONFLICT");
});

// ## A recording created by another user is invisible: NOT_FOUND, not FORBIDDEN
//
// Owner check mirrors `authorizeCaptureSessionOwner`: the caller's authenticated
// email must match the session's `createdBy`. A mismatch answers NOT_FOUND
// (hiding existence) rather than disclosing that a recording exists under
// someone else's account.
void test("Owner check mirrors authorizeCaptureSessionOwner:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L174
  const box = await makeTmpBox({ git: true });
  const session = await stageVoiceRecording(box, { targetSessionId: "chat-1", createdBy: "someone-else@example.com" });
  await requestHq({ box, session, emissionId: "em-1" });
  const stranger = caller(box);

  // doctest:L179
  t.check(await stranger.voiceRecording.status({ recordingId: session.id }).then(() => "no error", codeOf), "NOT_FOUND");
});
