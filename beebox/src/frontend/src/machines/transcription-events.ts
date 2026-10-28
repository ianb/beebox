/**
 * Internal event union for the realtime transcription machine, shared between
 * the machine and its callback actor. Kept in its own module so the actor can
 * reference the type without a value import cycle.
 */

import type { PendingRecording } from "../lib/audio/voice-stager";

/**
 * Why a live recording degraded mid-segment: the network transport stalled
 * or died ("network"), or the OS took the microphone away — phone call,
 * Siri, app switch, suspended AudioContext ("microphone"). A network drop
 * only pauses live text (the recording continues, `recordingLocal`); a mic
 * loss stops the audio itself (`reconnecting`).
 */
export type DropCause = "network" | "microphone";

/**
 * - `connecting`: mic permission and worklet startup, before any audio.
 * - `recordingLocal`: the mic is live and audio is staging to the box, but
 *   there is no live transcription socket (not yet open, dropped, or given
 *   up). No live text arrives, so spoken commands can't be heard.
 * - `recording`: mic live and live text flowing.
 * - `reconnecting`: the microphone was lost; recovery is bounded.
 */
export type TranscriptionState = "idle" | "connecting" | "recordingLocal" | "recording" | "reconnecting" | "finalizing";

/**
 * Whether a segment is live — capturing audio, or recovering the mic within
 * its window. Every "is a segment live" check (stop, manual send, cross-tab
 * mic eviction, `isTranscribing`) goes through this, so a new capturing state
 * can't be missed at one site. Keyword spotting is NOT one of these: it needs
 * live text, which only `recording` has.
 */
export function segmentCapturing(state: TranscriptionState): boolean {
  return state === "recording" || state === "recordingLocal" || state === "reconnecting";
}

/**
 * A finalized transcript word plus its acoustic confidence, captured from a
 * Deepgram `is_final` Results message. `confidence` is absent when the
 * service didn't report one (or reported something that failed the runtime
 * `typeof` guard at the WS boundary) — absent means "no data", not "low
 * confidence". Voxtral and OpenAI realtime never populate this.
 */
export interface FinalWord {
  word: string;
  confidence?: number;
}

/**
 * A machine action was reached by an event it wasn't wired for (a config bug).
 * The detail names the action and the offending event.
 */
export class MachineActionError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "MachineActionError";
  }
}

export type TranscriptionEvent =
  /** `targetSessionId` names the chat the recording starts in (null for a new chat). */
  | { type: "START"; targetSessionId: string | null }
  | { type: "STOP" }
  | { type: "CANCEL" }
  /**
   * Hold the mic while speech plays: the open segment stays open and records
   * silence, so it keeps its text and its one recording (which the HQ pass
   * covers) without taking down the speech. A segment started while held
   * starts held. `held: false` puts the mic back.
   */
  | { type: "HOLD"; held: boolean }
  | { type: "DISMISS_ERROR" }
  /** The mic is capturing and audio is staging; sent before any socket exists. */
  | { type: "MIC_LIVE" }
  | { type: "WS_CONNECTED" }
  | { type: "WS_ERROR"; message: string }
  | { type: "WS_CLOSED" }
  | { type: "CONNECTION_DEGRADED"; cause: DropCause }
  | { type: "CONNECTION_RESTORED" }
  | { type: "TEXT_UPDATE"; finalText: string; interimText: string; finalWords: FinalWord[] | null }
  /**
   * The segment ended. `recording` is the sealing obligation for its staged
   * audio: whoever ends up holding it must `seal` or `discard` it.
   */
  | { type: "TRANSCRIPTION_DONE"; text?: string; words?: FinalWord[] | null; recording: PendingRecording }
  | { type: "SERVER_ERROR"; message: string }
  | { type: "SETUP_ERROR"; message: string };

/** Emitted (not a transition event): the segment hit `MAX_DURATION` and is being submitted. */
export interface MaxDurationReached {
  type: "maxDurationReached";
}

/** Emitted: the idle close ended the segment, so the voice turn ends with it. */
export interface IdleClosed {
  type: "idleClosed";
}

/** Input the machine hands the actor for one segment. */
export interface TranscriptionActorInput {
  targetSessionId: string | null;
  /** Start recording silence (the mic is held; see the HOLD event). */
  held: boolean;
}

/** Commands the machine sends the actor. */
export type TranscriptionActorCommand = { type: "STOP" } | { type: "CANCEL" } | { type: "HOLD"; held: boolean };

/** Narrow `event` to `type`, or throw: `action` was wired to an event it can't handle. */
export function requireEvent<T extends TranscriptionEvent["type"]>(
  event: TranscriptionEvent,
  opts: { type: T; action: string },
): Extract<TranscriptionEvent, { type: T }> {
  // Narrowing through a type-predicate helper keeps the action bodies cast-free.
  const matches = (e: TranscriptionEvent): e is Extract<TranscriptionEvent, { type: T }> => e.type === opts.type;
  if (!matches(event)) {
    const message = `${opts.action}: unexpected event type "${event.type}"`;
    throw new MachineActionError(message);
  }
  return event;
}

// The idle close (issues/features/2026-10-28-web-live-recorder-closes-mic-after-idle.md).

/**
 * How long the mic stays open with no new live text before it closes as if
 * the person pressed stop. Counts live text, not mic silence: noise that
 * transcribes to nothing is still idle, and so is a mic whose live text is
 * down (the recording keeps what was said).
 */
export const NO_LIVE_TEXT_TIMEOUT_MS = 5 * 60 * 1000;

/** Shown after the idle close, so a closed mic is not mistaken for a lost one. */
export const IDLE_CLOSE_NOTICE = "Mic closed — no new words for 5 minutes";

/**
 * Whether a live-text update brings new words. Providers re-send unchanged
 * text (Deepgram answers noise with empty results, a reconnect re-sends the
 * segment), so only a change in the final text or a non-empty new interim
 * counts.
 */
export function isNewLiveText(
  prev: { finalTranscript: string; interimTranscript: string },
  next: { finalText: string; interimText: string },
): boolean {
  if (next.finalText !== prev.finalTranscript) return true;
  return next.interimText.trim() !== "" && next.interimText !== prev.interimTranscript;
}
