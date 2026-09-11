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

/** Input the machine hands the actor for one segment. */
export interface TranscriptionActorInput {
  targetSessionId: string | null;
}

/** Commands the machine sends the actor. */
export type TranscriptionActorCommand = { type: "STOP" } | { type: "CANCEL" };
