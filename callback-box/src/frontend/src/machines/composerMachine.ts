/**
 * Coordination overlay for the chat composer's speech ↔ mic interplay.
 *
 * Background: the composer's behaviour was an emergent cross-product of three
 * independent machines (`chatMachine`, `realtimeTranscriptionMachine`,
 * `speechPlaybackMachine`) glued by a pile of `useState`/`useRef` flags and
 * `useEffect` bodies in `InteractiveChat-voice.ts` / `-speech.ts`. The single
 * worst offender was `voicePaused`: a boolean straining to encode "the mic was
 * paused *for* this speech, so resume it when playback ends." See
 * `docs/composer-input-machine.md` for the design rationale.
 *
 * Scope: this machine owns only the *overlay* that no existing machine owns —
 * the three speech-coordination states `idle | speaking | pausedForSpeech`.
 * Whether the mic is recording is NOT modelled here; that genuinely belongs to
 * `realtimeTranscriptionMachine` and is mirrored in as the `recording` context
 * flag. Trying to own a `dictating` state here would duplicate that machine and
 * force a race-prone React mirror — so we don't.
 *
 *   - `speaking`         — TTS is playing; the mic was not recording, so nothing
 *                          to resume (turn-taking may still reopen it).
 *   - `pausedForSpeech`  — TTS is playing; the mic *was* recording and we paused
 *                          it. This is exactly what `voicePaused` meant: resume
 *                          the mic when playback ends.
 *
 * The machine commands the real mic/TTS devices through named action seams
 * (`startMic`, `resumeMic`, `cancelMic`, `stopSpeech`, `playSpeech`,
 * `markPlayed`) that the wiring provides via `.provide()`. Guards are pure
 * functions of context, so the decision logic is unit-testable with no React
 * (see `composerMachine.doctest.md`).
 */

import { setup, assign } from "xstate";
import type { SpeechSegment } from "../lib/speech-parsing";

export interface ComposerContext {
  /** Narration mode (HQ transcription on send, silent responses). Mirrored from the model hook. */
  narration: boolean;
  /** Speech muted. Mirrored from the mute hook; gates whether queued TTS ever plays. */
  muted: boolean;
  /** A voice conversation is active — reopen the mic after the agent finishes speaking/replying. */
  turnTaking: boolean;
  /** The transcription device is currently capturing. Mirrored from the transcription hook. */
  recording: boolean;
  /** Whether the live transcript currently has text. Suppresses TTS while the user is mid-utterance. */
  transcriptNonEmpty: boolean;
  /** Realtime text awaiting its HQ pass (narration). Rendered as a pending bubble; null when none. */
  pendingHqText: string | null;
}

export type ComposerEvent =
  // --- user intents from the composer buttons ---
  | { type: "START_DICTATION" }
  | { type: "STOP_DICTATION" }
  | { type: "STOP_SPEECH" }
  | { type: "RESUME" }
  // --- mirrored state of the transcription device ---
  | { type: "RECORDING"; value: boolean }
  | { type: "TRANSCRIPT"; nonEmpty: boolean }
  // --- signals from the playback device ---
  | { type: "SPEECH_QUEUED"; messageId: string; segments: SpeechSegment[]; baseIndex: number }
  /** Playback the machine didn't queue (manual replay): reflect that speech is now playing without re-playing it. */
  | { type: "SPEECH_EXTERNAL" }
  | { type: "SPEECH_DONE" }
  // --- the narration HQ round-trip ---
  | { type: "START_HQ"; text: string }
  | { type: "HQ_DONE" }
  // --- mirrored settings + send ---
  | { type: "SET_NARRATION"; value: boolean }
  | { type: "SET_MUTE"; value: boolean }
  | { type: "MESSAGE_SENT" }
  // --- mobile keyboard shell ---
  | { type: "OPEN_KEYBOARD" }
  | { type: "CLOSE_KEYBOARD" }
  | { type: "TOGGLE_LOCK" };

export const composerMachine = setup({
  types: {
    context: {} as ComposerContext,
    events: {} as ComposerEvent,
    input: {} as Partial<Pick<ComposerContext, "narration" | "muted">>,
  },
  guards: {
    isMuted: ({ context }) => context.muted,
    /** The mic is actively capturing (not connecting/finalizing) — only then do we pause it. */
    recording: ({ context }) => context.recording,
    /** The user has spoken text pending — suppress TTS so we don't talk over them. */
    transcriptNonEmpty: ({ context }) => context.transcriptNonEmpty,
    turnTaking: ({ context }) => context.turnTaking,
  },
  actions: {
    // Pure context assigns live here; side-effecting device commands are
    // declared as no-op stubs and overridden at wiring time via `.provide()`.
    beginTurn: assign({ turnTaking: true }),
    endTurn: assign({ turnTaking: false }),
    setRecording: assign(({ event }) => ({ recording: event.type === "RECORDING" ? event.value : false })),
    setNarration: assign(({ event }) => ({ narration: event.type === "SET_NARRATION" ? event.value : false })),
    setMute: assign(({ event }) => ({ muted: event.type === "SET_MUTE" ? event.value : false })),
    setTranscript: assign(({ event }) => ({ transcriptNonEmpty: event.type === "TRANSCRIPT" ? event.nonEmpty : false })),
    setPendingHq: assign(({ event }) => ({ pendingHqText: event.type === "START_HQ" ? event.text : null })),
    clearPendingHq: assign({ pendingHqText: null }),

    // --- device-command seams (provided by the wiring; no-ops here) ---
    /** Begin a fresh recording segment, with the recording-start earcon. */
    startMic: () => {},
    /** Resume recording quietly (no earcon) — after a pause. */
    resumeMic: () => {},
    /** Pause/tear down the current recording segment without finalizing. */
    cancelMic: () => {},
    /** Enqueue + play the segments carried on the current SPEECH_QUEUED event. */
    playSpeech: () => {},
    /** Stop TTS playback immediately. */
    stopSpeech: () => {},
    /** Mark the current SPEECH_QUEUED message as played without playing it (suppressed/muted). */
    markPlayed: () => {},
  },
}).createMachine({
  id: "composer",
  type: "parallel",
  context: ({ input }) => ({
    narration: input.narration ?? false,
    muted: input.muted ?? false,
    turnTaking: false,
    recording: false,
    transcriptNonEmpty: false,
    pendingHqText: null,
  }),
  // Internal (target-less) root handlers mirror device/settings state. None
  // exit a region.
  on: {
    SET_NARRATION: { actions: "setNarration" },
    SET_MUTE: { actions: "setMute" },
    RECORDING: { actions: "setRecording" },
    TRANSCRIPT: { actions: "setTranscript" },
  },
  states: {
    voice: {
      initial: "idle",
      // Region-level internal handler: any send ends the turn, without exiting
      // the current voice state. Sibling to the keyboard region's own
      // MESSAGE_SENT transition, so both run (an ancestor `on` would lose to a
      // descendant one, so it can't live on the root).
      on: {
        MESSAGE_SENT: { actions: "endTurn" },
      },
      states: {
        idle: {
          on: {
            // Recording lives in the transcription machine; these just track
            // turn-taking and command the mic device.
            START_DICTATION: { actions: ["beginTurn", "startMic"] },
            STOP_DICTATION: { actions: "endTurn" },
            SPEECH_QUEUED: [
              { guard: "isMuted", actions: "markPlayed" },
              { guard: "transcriptNonEmpty", actions: "markPlayed" }, // talking → don't speak over the user
              { guard: "recording", target: "pausedForSpeech", actions: ["cancelMic", "playSpeech"] },
              { target: "speaking", actions: "playSpeech" },
            ],
            SPEECH_EXTERNAL: [
              { guard: "recording", target: "pausedForSpeech", actions: "cancelMic" },
              { target: "speaking" },
            ],
          },
        },
        speaking: {
          on: {
            SPEECH_DONE: [
              { guard: "turnTaking", target: "idle", actions: "startMic" }, // reopen the mic for the next turn
              { target: "idle" },
            ],
            STOP_SPEECH: { target: "idle", actions: "stopSpeech" },
            START_DICTATION: { target: "idle", actions: ["stopSpeech", "beginTurn", "startMic"] },
            SPEECH_QUEUED: { actions: "playSpeech" }, // enqueue more segments, stay speaking
          },
        },
        pausedForSpeech: {
          on: {
            SPEECH_DONE: { target: "idle", actions: "resumeMic" }, // auto-resume the paused mic
            RESUME: { target: "idle", actions: ["stopSpeech", "resumeMic"] },
            STOP_SPEECH: { target: "idle", actions: ["stopSpeech", "resumeMic"] },
            SPEECH_QUEUED: { actions: "playSpeech" },
            START_DICTATION: { target: "idle", actions: ["stopSpeech", "beginTurn", "startMic"] },
          },
        },
      },
    },
    hq: {
      initial: "idle",
      states: {
        idle: { on: { START_HQ: { target: "inFlight", actions: "setPendingHq" } } },
        inFlight: { on: { HQ_DONE: { target: "idle", actions: "clearPendingHq" } } },
      },
    },
    keyboard: {
      initial: "closed",
      states: {
        closed: { on: { OPEN_KEYBOARD: "open" } },
        open: {
          initial: "unlocked",
          on: { CLOSE_KEYBOARD: "closed" },
          states: {
            unlocked: {
              on: {
                TOGGLE_LOCK: "locked",
                MESSAGE_SENT: "#composer.keyboard.closed", // auto-close after send
              },
            },
            locked: {
              on: { TOGGLE_LOCK: "unlocked" }, // stays open after send
            },
          },
        },
      },
    },
  },
});
