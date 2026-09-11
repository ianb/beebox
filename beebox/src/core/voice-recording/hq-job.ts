/**
 * The HQ transcription job's IO shell (`docs/plans/resilient-voice-recording.md`,
 * Track 1). Concatenates a voice recording's staged PCM chunks, cuts pieces
 * with `planPieces`, transcribes each piece in order via `transcribeAudioHq`,
 * retries a transient/piece-too-long failure with backoff or a halved piece
 * length, joins the results (relabeling diarized speakers per piece), and
 * persists every transition through `nextVoiceState` — emitting
 * `voice-recording-status` on the event bus after each one.
 *
 * Every wait is sleep-immune (`startAwakeTimeout`) and reached through an
 * injectable `clock` seam so a doctest can advance retries without a real
 * wall-clock wait; production callers omit it and get the real thing
 * (engineering principle #10). A module-scope in-flight set guards against
 * two concurrent runs of the same recording in this process, mirroring
 * `core/capture/prepare.ts`'s `inFlightIds`.
 */

import { invariant } from "../../lib/invariant.js";
import { errorMessage, errnoCode } from "../../lib/error-guards.js";
import { getBoxTime } from "../../lib/time.js";
import { startAwakeTimeout } from "../../lib/awake-timeout.js";
import { jitteredBackoff } from "../../shared/backoff.js";
import { buildWavHeader } from "../../shared/wav.js";
import type { EventBus } from "../event-bus.js";
import {
  findLastSpeakerLetter,
  nextSpeakerLetter,
  relabelDiarizedSpeakers,
} from "../transcription/voxtral.js";
import { readSessionLogTail } from "../chat/session/session-log-tail.js";
import { transcribeAudioHq, extractHqErrorInput } from "../transcription/index.js";
import type { HqTranscriptionService } from "../../shared/transcription-services.js";
import {
  readStagingSession,
  resolveStagedFile,
  type StagingSession,
} from "../capture/staging-store.js";
import type { HqFailure, VoiceHqResult } from "../capture/staging-schema.js";
import { applyVoiceEvent } from "./voice-staging.js";
import { planPieces, nextPieceSeconds, HQ_PIECE_SECONDS } from "./pieces.js";
import { classifyHqError } from "./classify.js";
import * as fs from "node:fs/promises";

/** How long the job keeps retrying a transient/piece-too-long failure before giving up. */
export const HQ_RETRY_BOUND_MS = 24 * 60 * 60 * 1000; // 24h

/** Backoff shape for a transient piece failure — shared idiom, box-specific bounds. */
const HQ_BACKOFF = { baseMs: 5_000, capMs: 5 * 60_000 };

/** One transcribed piece, before joining. */
interface PieceTranscription {
  text: string;
  diarized?: boolean;
}

/** The injectable clock + wait seam (inert in prod — real clock, real sleep-immune wait). */
export interface HqJobClock {
  now(): Date;
  wait(ms: number): Promise<void>;
}

function realWait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    startAwakeTimeout({ timeoutMs: ms, periodMs: Math.min(ms, 5_000), onTimeout: () => resolve() });
  });
}

/** The piece-transcription call, injectable so a doctest can script failures without a real HQ service. */
export type TranscribePieceFn = (
  params: { audioBuffer: Buffer; filename: string; boxRoot: string },
  opts: { service: HqTranscriptionService },
) => Promise<PieceTranscription>;

async function realTranscribePiece(
  params: { audioBuffer: Buffer; filename: string; boxRoot: string },
  opts: { service: HqTranscriptionService },
): Promise<PieceTranscription> {
  const result = await transcribeAudioHq(params, { service: opts.service });
  return { text: result.text, ...(result.diarized !== undefined && { diarized: result.diarized }) };
}

export interface RunHqJobDeps {
  boxRoot: string;
  /** The voice recording's id — also its staging session id. */
  id: string;
  eventBus: EventBus;
  clock?: HqJobClock;
  transcribePiece?: TranscribePieceFn;
}

/** Recording ids with a job running in THIS process right now. */
const inFlightRecordingIds = new Set<string>();

/**
 * Run (or resume) the HQ job for one voice recording. Idempotent: a session
 * whose `hq.state` is already `ready`/`failed` returns immediately, and a
 * second concurrent call for the same id is a no-op (logged).
 */
export async function runHqJob(deps: RunHqJobDeps): Promise<void> {
  const { id } = deps;
  if (inFlightRecordingIds.has(id)) {
    console.warn(`[voice-recording] HQ job for ${id} already in flight; skipping re-fire.`);
    return;
  }
  inFlightRecordingIds.add(id);
  try {
    await runHqJobInner(deps);
  } finally {
    inFlightRecordingIds.delete(id);
  }
}

function emitStatus(opts: { eventBus: EventBus; session: StagingSession }): void {
  const { eventBus, session } = opts;
  invariant(session.voice !== undefined, "emitStatus requires a voice session");
  eventBus.emit("voice-recording-status", {
    recordingId: session.id,
    sessionId: session.voice.targetSessionId,
    hq: session.voice.hq,
    handoff: session.voice.handoff,
  });
}

async function readConcatenatedPcm(opts: { boxRoot: string; session: StagingSession }): Promise<Buffer> {
  const { boxRoot, session } = opts;
  const segment = session.segments.find((s) => s.id === session.id);
  if (segment === undefined || segment.chunks.length === 0) return Buffer.alloc(0);
  const buffers = await Promise.all(
    segment.chunks.map((filename) => fs.readFile(resolveStagedFile({ boxRoot, id: session.id, filename }))),
  );
  return Buffer.concat(buffers);
}

function buildFailure(opts: { error: unknown; input: { status?: number; body?: string } }): Omit<HqFailure, "kind"> {
  const { error, input } = opts;
  const code = errnoCode(error) ?? (input.status !== undefined ? `http_${String(input.status)}` : "hq_error");
  return {
    code,
    message: errorMessage(error),
    ...(input.status !== undefined && { upstreamStatus: input.status }),
    ...(input.body !== undefined && { upstreamBody: input.body }),
  };
}

/**
 * Join every piece's text into one `VoiceHqResult`. Non-diarized pieces join
 * with a blank line (matching the multi-clip join the existing HQ route
 * uses elsewhere). Diarized pieces each get the NEXT speaker letter — seeded
 * from the target session's log tail, exactly as the narration-mode HQ route
 * does for a single recording (boxholder decision 2) — and, when there is
 * more than one piece, a `— part N of M —` marker precedes each.
 */
async function joinPieceResults(opts: {
  pieces: PieceTranscription[];
  boxRoot: string;
  targetSessionId: string;
  service: string;
}): Promise<VoiceHqResult> {
  const { pieces, boxRoot, targetSessionId, service } = opts;
  const diarized = pieces.some((p) => p.diarized === true);
  if (!diarized) {
    return { text: pieces.map((p) => p.text).join("\n\n"), diarized: false, service, pieces: pieces.length };
  }
  const priorText = await readSessionLogTail(boxRoot, targetSessionId);
  let letter = nextSpeakerLetter(findLastSpeakerLetter(priorText));
  const parts: string[] = [];
  for (const [index, piece] of pieces.entries()) {
    const relabeled = relabelDiarizedSpeakers(piece.text, letter);
    parts.push(pieces.length > 1 ? `— part ${String(index + 1)} of ${String(pieces.length)} —\n${relabeled}` : relabeled);
    letter = nextSpeakerLetter(letter);
  }
  return { text: parts.join("\n\n"), diarized: true, service, pieces: pieces.length };
}

async function runHqJobInner(deps: RunHqJobDeps): Promise<void> {
  const { boxRoot, id, eventBus } = deps;
  const clock: HqJobClock = deps.clock ?? { now: () => getBoxTime(boxRoot), wait: realWait };
  const transcribePiece = deps.transcribePiece ?? realTranscribePiece;

  const session = await readStagingSession({ boxRoot, id });
  if (session === null) return; // discarded between seal and here
  if (session.kind !== "voice" || session.voice === undefined) return;
  const { hqRequest } = session.voice;
  if (hqRequest === undefined) return; // hq was never requested
  if (session.voice.hq.state === "ready" || session.voice.hq.state === "failed") return; // already done

  const buffer = await readConcatenatedPcm({ boxRoot, session });

  let pieceSeconds = HQ_PIECE_SECONDS;
  if (session.voice.hq.state === "transcribing" || session.voice.hq.state === "retrying") {
    pieceSeconds = session.voice.hq.pieceSeconds;
  }

  // Resuming into `retrying` (a restart mid-backoff): wait out the remainder
  // of the recorded `nextAttemptAt` before the first attempt, rather than
  // retrying immediately just because the process restarted.
  if (session.voice.hq.state === "retrying") {
    const remainingMs = new Date(session.voice.hq.nextAttemptAt).getTime() - clock.now().getTime();
    if (remainingMs > 0) await clock.wait(remainingMs);
  }

  // Seed the attempt counter from the resumed state so a restart mid-backoff
  // continues the same jitteredBackoff curve instead of re-warming from
  // attempt 1 (which would retry faster than intended right after a
  // restart, still-transient failures aside).
  let attempt =
    session.voice.hq.state === "transcribing" || session.voice.hq.state === "retrying" ? session.voice.hq.attempt : 0;
  for (;;) {
    const elapsedMs = clock.now().getTime() - new Date(hqRequest.requestedAt).getTime();
    if (elapsedMs >= HQ_RETRY_BOUND_MS) {
      const expired = await applyVoiceEvent({ boxRoot, id, event: { type: "expired" } });
      emitStatus({ eventBus, session: { ...session, voice: expired } });
      return;
    }

    const pieces = planPieces(buffer.length, pieceSeconds);
    const results: PieceTranscription[] = [];
    let restartWithNewPieceLength = false;

    let pieceIndex = 0;
    while (pieceIndex < pieces.length) {
      const elapsedBeforeAttempt = clock.now().getTime() - new Date(hqRequest.requestedAt).getTime();
      if (elapsedBeforeAttempt >= HQ_RETRY_BOUND_MS) {
        const expired = await applyVoiceEvent({ boxRoot, id, event: { type: "expired" } });
        emitStatus({ eventBus, session: { ...session, voice: expired } });
        return;
      }
      attempt++;
      const piece = pieces[pieceIndex];
      invariant(piece !== undefined, "piece index in range");
      const started = await applyVoiceEvent({
        boxRoot,
        id,
        event: { type: "pieceStarted", piece: pieceIndex + 1, pieces: pieces.length, attempt, pieceSeconds },
      });
      emitStatus({ eventBus, session: { ...session, voice: started } });

      const pieceBytes = buffer.subarray(piece.startByte, piece.endByte);
      const header = buildWavHeader({ sampleRate: 16_000, channels: 1, byteLength: pieceBytes.length });
      const wavBuffer = Buffer.concat([Buffer.from(header), pieceBytes]);

      try {
        const result = await transcribePiece(
          { audioBuffer: wavBuffer, filename: `piece-${String(pieceIndex + 1)}.wav`, boxRoot },
          { service: hqRequest.service },
        );
        results.push(result);
        pieceIndex++;
        continue;
      } catch (error) {
        const input = extractHqErrorInput(error);
        const classification = classifyHqError(input);
        const failure = buildFailure({ error, input });

        if (classification === "permanent") {
          const failed = await applyVoiceEvent({
            boxRoot,
            id,
            event: {
              type: "pieceFailed",
              classification: "permanent",
              pieceSeconds,
              attempt,
              nextAttemptAt: clock.now().toISOString(),
              failure,
            },
          });
          emitStatus({ eventBus, session: { ...session, voice: failed } });
          return;
        }

        if (classification === "piece-too-long") {
          const shorter = nextPieceSeconds(pieceSeconds);
          if (shorter === null) {
            const failed = await applyVoiceEvent({
              boxRoot,
              id,
              event: {
                type: "pieceFailed",
                classification: "permanent",
                pieceSeconds,
                attempt,
                nextAttemptAt: clock.now().toISOString(),
                failure,
              },
            });
            emitStatus({ eventBus, session: { ...session, voice: failed } });
            return;
          }
          pieceSeconds = shorter;
          const retrying = await applyVoiceEvent({
            boxRoot,
            id,
            event: {
              type: "pieceFailed",
              classification: "piece-too-long",
              pieceSeconds,
              attempt,
              nextAttemptAt: clock.now().toISOString(),
              failure,
            },
          });
          emitStatus({ eventBus, session: { ...session, voice: retrying } });
          restartWithNewPieceLength = true;
          break;
        }

        // transient — retry the SAME piece after a backoff wait.
        const backoffMs = jitteredBackoff(attempt, HQ_BACKOFF);
        const nextAttemptAt = new Date(clock.now().getTime() + backoffMs).toISOString();
        const retrying = await applyVoiceEvent({
          boxRoot,
          id,
          event: { type: "pieceFailed", classification: "transient", pieceSeconds, attempt, nextAttemptAt, failure },
        });
        emitStatus({ eventBus, session: { ...session, voice: retrying } });
        await clock.wait(backoffMs);
        // loop again at the same pieceIndex
      }
    }

    if (restartWithNewPieceLength) continue;

    const result = await joinPieceResults({
      pieces: results,
      boxRoot,
      targetSessionId: session.voice.targetSessionId,
      service: hqRequest.service,
    });
    const done = await applyVoiceEvent({ boxRoot, id, event: { type: "allPiecesDone", result } });
    emitStatus({ eventBus, session: { ...session, voice: done } });
    return;
  }
}
