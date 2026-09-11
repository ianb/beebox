/**
 * Voice-recording GC sweep (`docs/plans/resilient-voice-recording.md`,
 * Track 1). Runs on the same awake-timeout cadence as the capture
 * abandonment sweep (`core/capture/sweep.ts`'s `scheduleAbandonmentSweep`,
 * wired from `webapp/routes/voice-lifecycle.ts`).
 *
 * Deletes a voice session's staging directory:
 * - `VOICE_STAGING_RETENTION_MS` after creation, if it was never sealed
 *   (abandoned recording — closed tab, cancelled before finalize); or
 * - `VOICE_STAGING_RETENTION_MS` after `voice.terminalAt` — see
 *   {@link isVoiceTerminal} for what counts as terminal.
 */

import { getBoxTime } from "../../lib/time.js";
import { listStagingSessions, isVoiceSession, type StagingSession } from "../capture/staging-store.js";
import { cleanupStagingSession } from "../capture/staging-teardown.js";
import { isVoiceTerminal } from "./voice-staging.js";

/** How long a voice recording's staging directory survives past "never sealed" or "terminal". */
export const VOICE_STAGING_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface VoiceSweepResult {
  /** Session ids whose staging directory was deleted this pass. */
  deleted: string[];
}

function isPastRetention(opts: { sinceIso: string; now: number }): boolean {
  const { sinceIso, now } = opts;
  return now - new Date(sinceIso).getTime() >= VOICE_STAGING_RETENTION_MS;
}

/** The timestamp a session's retention counts from, or null while it is kept regardless of age. */
function retentionStart(session: StagingSession): string | null {
  const { voice } = session;
  if (voice === undefined) return null; // schema invariant guards this in practice
  if (session.state === "open") return session.createdAt;
  if (isVoiceTerminal(voice)) return voice.terminalAt ?? session.lastActivityAt;
  return null;
}

/** Sweep one box's voice staging sessions once. Idempotent and safe to double-fire. */
export async function sweepVoiceSessions(opts: { boxRoot: string }): Promise<VoiceSweepResult> {
  const { boxRoot } = opts;
  const now = getBoxTime(boxRoot).getTime();
  const sessions = (await listStagingSessions({ boxRoot })).filter(isVoiceSession);
  const result: VoiceSweepResult = { deleted: [] };
  for (const session of sessions) {
    const since = retentionStart(session);
    if (since === null || !isPastRetention({ sinceIso: since, now })) continue;
    await cleanupStagingSession({ boxRoot, id: session.id });
    result.deleted.push(session.id);
  }
  return result;
}
