/**
 * Late delivery of the HQ correction (`docs/plans/resilient-voice-recording.md`,
 * Track 1's "next chunk"). Once a recording's HQ result is `ready` and the
 * client chose the realtime fallback (`handoff.mode === "late"`), the server
 * delivers `<speech corrects="…">` into the target session — but only after
 * confirming the ORIGINAL realtime message actually landed there first.
 * `fallBack` (`webapp/trpc/routers/voice-recording.ts`) can record `late`
 * before the client's own realtime send completes, and that send can still
 * fail, or the tab can die in between — a correction is never sent for a
 * message that never arrived (boxholder decision 1).
 *
 * Handoff moves `late → delivering` (via `lateDeliveryStarted`) only once the
 * original is confirmed landed, and only to `delivered` once the CORRECTION
 * itself is confirmed landed. `deliverUserMessage` may only enqueue (agent
 * busy), which is not "delivered": a crash before the queue drains would
 * silently lose a message the state machine already called done. So
 * `delivering` is an at-least-once state: {@link attemptLateDelivery} is safe
 * to call again for a `delivering` recording whose correction hasn't landed
 * yet and whose target session is idle — the landed probe (a substring match
 * on the recording id, which appears only in the correction's `message-id`)
 * is what makes a repeat call harmless. It is called from three triggers, all
 * converging on this one function: right after the HQ job persists
 * `allPiecesDone` while `late` (`hq-job.ts`), the periodic voice sweep's
 * `lateDeliveryPending` hook (`voice-lifecycle.ts`), and startup resume
 * (`core/capture/resume.ts`).
 *
 * Single-flight per recording id, mirroring `hq-job.ts`'s
 * `inFlightRecordingIds`, so a sweep tick and a job's own trigger can never
 * race into a double send.
 */

import { invariant } from "../../lib/invariant.js";
import { errorMessage } from "../../lib/error-guards.js";
import type { EventBus } from "../event-bus.js";
import type { ChatSession } from "../chat/session/index.js";
import type { ChatSessionRegistry } from "../chat/session/registry.js";
import { deliverUserMessage, userMessageAlreadyLanded } from "../chat/session/deliver-user-message.js";
import { loadHistory } from "../chat/session/history.js";
import { loadSessionHistory } from "../chat/session/load-history.js";
import { userIdentity } from "../../cli/lib/session-entry.js";
import { MAX_SESSION_ENTRIES } from "../../cli/lib/session.js";
import {
  readStagingSession,
  type StagingSession,
  type StagingVoice,
} from "../capture/staging-store.js";
import { applyVoiceEvent } from "./voice-staging.js";

/** One correction's speaker attribution, carried through from the original message. */
export interface CorrectionAttribution {
  name: string;
  email: string;
}

/** Matches `injectUserAttr`'s (`webapp/routes/chat-helpers.ts`) attribute escaping exactly. */
function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;");
}

/**
 * Build the `<speech corrects="…">` wire text for a late-delivered HQ
 * correction. Attribute order follows the plan's vocabulary lock-in:
 * `stt`, `stt-service`, `diarized`, `message-id`, `corrects`, then the
 * optional `user`/`user-email` (carried over from the original message, when
 * it could be resolved — see {@link resolveOriginalAttribution}). The body
 * is the HQ transcript text, unescaped: like `assembleChatMessage`
 * (`frontend/src/input/targets/chat-assemble.ts`), the outer wrapper is
 * first-party content, not an injection vector to fence.
 *
 * Example: `buildCorrectionWrapper({ recordingId: "rec-1", emissionId:
 * "em-1", service: "mai-diarized", diarized: true, text: "1A: hello" })` →
 * `<speech stt="hq" stt-service="mai-diarized" diarized="1"
 * message-id="rec-1" corrects="em-1">1A: hello</speech>`.
 */
export function buildCorrectionWrapper(opts: {
  recordingId: string;
  emissionId: string;
  service: string;
  diarized: boolean;
  text: string;
  user?: CorrectionAttribution | undefined;
}): string {
  const { recordingId, emissionId, service, diarized, text, user } = opts;
  const diarizedAttr = diarized ? " diarized=\"1\"" : "";
  const userAttrs = user
    ? ` user="${escapeAttr(user.name)}" user-email="${escapeAttr(user.email)}"`
    : "";
  return `<speech stt="hq" stt-service="${service}"${diarizedAttr} message-id="${recordingId}" corrects="${emissionId}"${userAttrs}>${text}</speech>`;
}

/**
 * Best-effort: find the original message (identified by its `message-id`
 * attribute, the emission id) in the target session's recent transcript and
 * read off its `user`/`user-email` attributes, so the correction attributes
 * to the same person. Returns `undefined` when the original isn't in the
 * loaded tail (bounded — `MAX_SESSION_ENTRIES`) or carries no attribution
 * (unauthenticated/open-mode box) — the caller sends without `user` rather
 * than failing delivery over a cosmetic field.
 */
async function resolveOriginalAttribution(opts: {
  boxRoot: string;
  sessionId: string;
  emissionId: string;
}): Promise<CorrectionAttribution | undefined> {
  const { boxRoot, sessionId, emissionId } = opts;
  try {
    const { entries } = await loadSessionHistory(boxRoot, {
      sessionId,
      slice: { mode: "page", offset: 0, limit: MAX_SESSION_ENTRIES },
    });
    const marker = `message-id="${emissionId}"`;
    const original = entries.find((entry) => entry.content.some(
      (block) => block.type === "text" && block.text?.includes(marker) === true,
    ));
    if (original === undefined) return undefined;
    const name = userIdentity(original.content, "user");
    const email = userIdentity(original.content, "user-email");
    if (name === undefined || email === undefined) return undefined;
    return { name, email };
  } catch (error) {
    console.warn(`[voice-recording] Could not resolve attribution for correction on ${sessionId}:`, errorMessage(error));
    return undefined;
  }
}

/**
 * Whether `sessionId` still resolves to a real chat target — a live
 * reservation, or a session recorded in box history. Mirrors
 * `resolveBulkDeliveryTarget` (`core/bulk-upload/deliver.ts`): late delivery,
 * like bulk, has no most-active fallback — a correction either reaches the
 * chat it was recorded against or stays retryable.
 */
async function targetSessionExists(opts: {
  boxRoot: string;
  sessionId: string;
  registry: ChatSessionRegistry;
}): Promise<boolean> {
  const { boxRoot, sessionId, registry } = opts;
  if (registry.getReservation(sessionId) !== null) return true;
  const known = await loadHistory(boxRoot);
  return known.includes(sessionId);
}

/** A staging session known to be voice-kind — narrows `voice` off its optional declaration. */
interface VoiceStagingSession extends StagingSession {
  voice: StagingVoice;
}

function isVoiceStagingSession(session: StagingSession): session is VoiceStagingSession {
  return session.kind === "voice" && session.voice !== undefined;
}

/** Recording ids with a late-delivery attempt running in THIS process right now. */
const inFlightDeliveryIds = new Set<string>();

export interface AttemptLateDeliveryDeps {
  boxRoot: string;
  /** The voice recording's id — also its staging session id. */
  id: string;
  eventBus: EventBus;
  registry: ChatSessionRegistry;
  wireSession?: ((session: ChatSession) => void) | undefined;
}

/**
 * Advance one recording's late-delivery handoff by one step: from `late`,
 * probe for the original and (if landed) move to `delivering`; from
 * `delivering`, probe for the correction and either confirm `delivered` or,
 * if the target session is idle, send it. A no-op for any other handoff mode,
 * for a recording whose HQ result isn't `ready`, or while already in flight.
 */
export async function attemptLateDelivery(deps: AttemptLateDeliveryDeps): Promise<void> {
  const { id } = deps;
  if (inFlightDeliveryIds.has(id)) {
    console.warn(`[voice-recording] Late delivery for ${id} already in flight; skipping re-fire.`);
    return;
  }
  inFlightDeliveryIds.add(id);
  try {
    await attemptLateDeliveryInner(deps);
  } finally {
    inFlightDeliveryIds.delete(id);
  }
}

async function attemptLateDeliveryInner(deps: AttemptLateDeliveryDeps): Promise<void> {
  const { boxRoot, id, eventBus, registry, wireSession } = deps;

  const initial = await readStagingSession({ boxRoot, id });
  if (initial === null || !isVoiceStagingSession(initial)) return;
  const { hqRequest } = initial.voice;
  if (hqRequest === undefined || initial.voice.hq.state !== "ready") return;
  if (initial.voice.handoff.mode !== "late" && initial.voice.handoff.mode !== "delivering") return;
  // Late delivery starts only from `fallBack`, which always writes the session
  // the realtime message was sent to (`state.ts`, applyFallBackRequested).
  const { sessionId } = hqRequest;
  invariant(sessionId !== null, `late delivery for ${id} has no target session`);

  if (initial.voice.handoff.mode === "late") {
    const originalLanded = await userMessageAlreadyLanded({
      boxRoot,
      sessionId: sessionId,
      marker: hqRequest.emissionId,
      logPrefix: "voice-recording",
    });
    await applyVoiceEvent({ boxRoot, id, event: { type: "lateDeliveryStarted", originalLanded } });
    if (!originalLanded) return; // stays `late`; the next sweep tick / resume re-probes
  }

  // Re-read: the transition above (or a concurrent caller, guarded out by the
  // in-flight set, but not by a DIFFERENT process) may have changed the state.
  const current = await readStagingSession({ boxRoot, id });
  if (current === null || !isVoiceStagingSession(current) || current.voice.handoff.mode !== "delivering") return;

  const correctionLanded = await userMessageAlreadyLanded({
    boxRoot,
    sessionId: sessionId,
    marker: id,
    logPrefix: "voice-recording",
  });
  if (correctionLanded) {
    await applyVoiceEvent({ boxRoot, id, event: { type: "landedConfirmed", messageId: id } });
    return;
  }

  const targetSession = registry.get(sessionId);
  if (targetSession !== null && targetSession.isBusy()) {
    return; // stays `delivering`; the next tick re-checks once the agent frees up
  }
  if (!(await targetSessionExists({ boxRoot, sessionId: sessionId, registry }))) {
    console.error(`[voice-recording] Late-delivery target ${sessionId} for ${id} no longer resolves; staying delivering`);
    return;
  }

  invariant(current.voice.hq.state === "ready", "delivering requires a ready HQ result (state.ts enforces this)");
  const { result } = current.voice.hq;
  const user = await resolveOriginalAttribution({ boxRoot, sessionId: sessionId, emissionId: hqRequest.emissionId });
  const wrapper = buildCorrectionWrapper({
    recordingId: id,
    emissionId: hqRequest.emissionId,
    service: result.service,
    diarized: result.diarized,
    text: result.text,
    user,
  });

  try {
    await deliverUserMessage({
      boxRoot,
      registry,
      eventBus,
      wireSession,
      target: { sessionId: sessionId, contextDir: null },
      message: wrapper,
      logPrefix: "voice-recording",
    });
  } catch (error) {
    console.error(`[voice-recording] Late-delivery send for ${id} failed; staying delivering:`, error);
    return;
  }

  const landedNow = await userMessageAlreadyLanded({
    boxRoot,
    sessionId: sessionId,
    marker: id,
    logPrefix: "voice-recording",
  });
  if (landedNow) {
    await applyVoiceEvent({ boxRoot, id, event: { type: "landedConfirmed", messageId: id } });
  }
  // Else: `deliverUserMessage` only enqueued behind a busy agent (a race
  // against the `isBusy()` check above). Stays `delivering`; the next tick
  // confirms once the enqueued message drains.
}
