/**
 * Internal event union for the realtime transcription machine, shared between
 * the machine and its callback actor. Kept in its own module so the actor can
 * reference the type without a value import cycle.
 */

export type TranscriptionEvent =
  | { type: "START" }
  | { type: "STOP" }
  | { type: "CANCEL" }
  | { type: "DISMISS_ERROR" }
  | { type: "WS_CONNECTED" }
  | { type: "WS_ERROR"; message: string }
  | { type: "WS_CLOSED" }
  | { type: "TEXT_UPDATE"; finalText: string; interimText: string }
  | { type: "TRANSCRIPTION_DONE"; text?: string; audioBlob?: Blob }
  | { type: "SERVER_ERROR"; message: string }
  | { type: "SETUP_ERROR"; message: string };
