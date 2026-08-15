/**
 * Internal event union for the realtime transcription machine, shared between
 * the machine and its callback actor. Kept in its own module so the actor can
 * reference the type without a value import cycle.
 */

/**
 * Why a live recording degraded mid-segment: the network transport stalled
 * or died ("network"), or the OS took the microphone away — phone call,
 * Siri, app switch, suspended AudioContext ("microphone"). Drives the
 * user-facing messaging so the user learns *why* recording dropped.
 */
export type DropCause = "network" | "microphone";

export type TranscriptionState = "idle" | "connecting" | "recording" | "reconnecting" | "finalizing";

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
  | { type: "START" }
  | { type: "STOP" }
  | { type: "CANCEL" }
  | { type: "DISMISS_ERROR" }
  | { type: "WS_CONNECTED" }
  | { type: "WS_ERROR"; message: string }
  | { type: "WS_CLOSED" }
  | { type: "CONNECTION_DEGRADED"; cause: DropCause }
  | { type: "CONNECTION_RESTORED" }
  | { type: "TEXT_UPDATE"; finalText: string; interimText: string; finalWords: FinalWord[] }
  | { type: "TRANSCRIPTION_DONE"; text?: string; audioBlob?: Blob; words?: FinalWord[] }
  | { type: "SERVER_ERROR"; message: string }
  | { type: "SETUP_ERROR"; message: string };
