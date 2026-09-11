/**
 * `get-last-audio` lookup over voice staging (`docs/plans/resilient-voice-recording.md`,
 * Track 5). A web voice send's recording lives on the box as staged PCM
 * chunks, so the server answers `bbx chat get-last-audio` / `retranscribe`
 * for it directly, before relaying to chat tabs (`chat-last-audio-routes.ts`).
 *
 * A recording is found by the message's emission id: `hqRequest.emissionId`
 * (written by the finalize that sealed it) or `handoff.emissionId` (written
 * by claim/fallBack). Both are written only once the recording is sealed,
 * so a match always has every chunk.
 */

import { buildWavHeader } from "../../shared/wav.js";
import { listStagingSessions, isVoiceSession, type StagingSession } from "../capture/staging-store.js";
import { readConcatenatedPcm } from "./hq-job.js";

export interface StagedVoiceAudio {
  /** 16 kHz mono s16 WAV. */
  wav: Buffer;
  /** When the recording was sealed (server clock). */
  recordedAt: string | null;
  /** The message's text: the HQ transcript when the client sent it (`claimed`), else unknown here. */
  text: string | null;
  /** The chat the HQ request named, if known. */
  sessionId: string | null;
}

function matchesMessage(session: StagingSession, messageId: string): boolean {
  const { voice } = session;
  if (voice === undefined) return false;
  if (voice.hqRequest?.emissionId === messageId) return true;
  return voice.handoff.mode !== "open" && voice.handoff.emissionId === messageId;
}

/** The staged recording for a voice message, as WAV, or null when no staging session names it. */
export async function findStagedVoiceAudio(opts: { boxRoot: string; messageId: string }): Promise<StagedVoiceAudio | null> {
  const { boxRoot, messageId } = opts;
  const sessions = (await listStagingSessions({ boxRoot })).filter(isVoiceSession);
  const session = sessions.find((s) => matchesMessage(s, messageId));
  if (session?.voice === undefined) return null;
  const pcm = await readConcatenatedPcm({ boxRoot, session });
  const header = buildWavHeader({ sampleRate: 16_000, channels: 1, byteLength: pcm.length });
  const { voice } = session;
  return {
    wav: Buffer.concat([Buffer.from(header), pcm]),
    recordedAt: voice.sealedAt ?? null,
    text: voice.handoff.mode === "claimed" && voice.hq.state === "ready" ? voice.hq.result.text : null,
    sessionId: voice.hqRequest?.sessionId ?? voice.targetSessionId,
  };
}
