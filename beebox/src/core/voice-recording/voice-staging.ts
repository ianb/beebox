/**
 * IO glue between the pure `nextVoiceState` transition function
 * (`./state.ts`) and the on-disk staging session
 * (`core/capture/staging-store.ts`), plus the seal + terminal-detection logic
 * the finalize route and the voice sweep both need
 * (`docs/plans/resilient-voice-recording.md`, Track 1).
 *
 * Every persisted voice transition goes through {@link applyVoiceEvent} —
 * read-modify-write under the session's existing per-session lock, so a
 * concurrent finalize/job-tick pair can't interleave two transitions.
 */

import { invariant } from "../../lib/invariant.js";
import { getBoxTimeISO } from "../../lib/time.js";
import {
  readStagingSession,
  withStagingLock,
  writeStagingSession,
  type StagingSession,
  type StagingVoice,
} from "../capture/staging-store.js";
import { StagingSessionGoneError } from "../capture/staging-errors.js";
import type { HqTranscriptionService } from "../../shared/transcription-services.js";
import { nextVoiceState, type VoiceEvent, type VoiceTransitionRefusal } from "./state.js";

/** Raised when a voice transition is refused (see {@link VoiceTransitionRefusal}). Maps to 409 at the route. */
export class VoiceTransitionRefusedError extends Error {
  readonly refusal: VoiceTransitionRefusal;
  constructor(id: string, refusal: VoiceTransitionRefusal) {
    super(`Voice session ${id}: ${refusal.message} (${refusal.code})`);
    this.name = "VoiceTransitionRefusedError";
    this.refusal = refusal;
  }
}

function asVoiceSession(session: StagingSession, id: string): asserts session is StagingSession & { voice: StagingVoice } {
  invariant(session.kind === "voice" && session.voice !== undefined, `staging session ${id} is not a voice session`);
}

/**
 * True once a recording has reached a condition the voice sweep may GC after
 * {@link VOICE_STAGING_RETENTION_MS} (defined in `./sweep.ts`) — the client
 * decided which text to send (`claimed`/`fellBack`), or the HQ pass is done
 * trying (`failed`) or was never requested (`none`) on a sealed session.
 */
export function isVoiceTerminal(voice: StagingVoice): boolean {
  if (voice.handoff.mode === "claimed" || voice.handoff.mode === "fellBack") return true;
  return voice.sealedAt !== undefined && (voice.hq.state === "failed" || voice.hq.state === "none");
}

/** Outcome of {@link sealVoiceSession}. */
export interface VoiceSealResult {
  /** True when THIS call performed the open→sealed transition. */
  sealed: boolean;
  /** True when the session was already sealed/in-flight (idempotent repeat). */
  alreadySealed: boolean;
  voice: StagingVoice;
}

/**
 * Compare-and-swap a voice session `open → sealed`, stamping `voice.sealedAt`,
 * and — when `hq` is given — apply the `requested` transition in the SAME
 * atomic write (so a resume never observes "sealed" without also knowing its
 * HQ request). A repeat call when already sealed returns the current state
 * without re-sealing; if `hq` disagrees with an existing `hqRequest` (a
 * different `emissionId`), the mismatch surfaces as
 * {@link VoiceTransitionRefusedError} (mapped to 409 by the route).
 */
export async function sealVoiceSession(opts: {
  boxRoot: string;
  id: string;
  hq: { emissionId: string; sessionId: string | null; service: HqTranscriptionService; requestedAt: string } | null;
}): Promise<VoiceSealResult> {
  const { boxRoot, id, hq } = opts;
  return withStagingLock(id, async () => {
    const session = await readStagingSession({ boxRoot, id });
    if (!session) throw new StagingSessionGoneError(id);
    asVoiceSession(session, id);

    if (session.state !== "open") {
      if (hq !== null && session.voice.hqRequest !== undefined && session.voice.hqRequest.emissionId !== hq.emissionId) {
        throw new VoiceTransitionRefusedError(id, {
          code: "emission-mismatch",
          message: "finalize was already called with a different HQ request for this recording",
        });
      }
      return { sealed: false, alreadySealed: true, voice: session.voice };
    }

    session.state = "sealed";
    session.voice.sealedAt = getBoxTimeISO(boxRoot);
    if (hq !== null) {
      const outcome = nextVoiceState(session.voice, {
        type: "requested",
        requestedAt: hq.requestedAt,
        service: hq.service,
        emissionId: hq.emissionId,
        sessionId: hq.sessionId,
      });
      if (!outcome.ok) throw new VoiceTransitionRefusedError(id, outcome.error);
      session.voice = outcome.value;
    }
    if (isVoiceTerminal(session.voice) && session.voice.terminalAt === undefined) {
      session.voice.terminalAt = session.voice.sealedAt;
    }
    session.lastActivityAt = getBoxTimeISO(boxRoot);
    await writeStagingSession({ boxRoot, session });
    return { sealed: true, alreadySealed: false, voice: session.voice };
  });
}

/**
 * Apply one {@link VoiceEvent} to a voice session's `voice` object under its
 * lock, stamping `terminalAt` (once, on first becoming terminal) in the same
 * write. Throws {@link VoiceTransitionRefusedError} for a refused transition,
 * and {@link StagingSessionGoneError} if the session vanished (a discard
 * racing the job).
 */
export async function applyVoiceEvent(opts: { boxRoot: string; id: string; event: VoiceEvent }): Promise<StagingVoice> {
  const { boxRoot, id, event } = opts;
  return withStagingLock(id, async () => {
    const session = await readStagingSession({ boxRoot, id });
    if (!session) throw new StagingSessionGoneError(id);
    asVoiceSession(session, id);
    const outcome = nextVoiceState(session.voice, event);
    if (!outcome.ok) throw new VoiceTransitionRefusedError(id, outcome.error);
    session.voice = outcome.value;
    if (isVoiceTerminal(session.voice) && session.voice.terminalAt === undefined) {
      session.voice.terminalAt = getBoxTimeISO(boxRoot);
    }
    session.lastActivityAt = getBoxTimeISO(boxRoot);
    await writeStagingSession({ boxRoot, session });
    return session.voice;
  });
}
