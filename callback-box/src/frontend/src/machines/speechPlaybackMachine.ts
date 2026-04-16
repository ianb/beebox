/**
 * XState machine for TTS speech playback.
 *
 * States: idle → playing → idle
 *
 * Plays one segment per actor invocation and re-enters `playing` while
 * there are more queued. This lets additional PLAY events arriving while
 * speech is in-flight append to a queue rather than being dropped — which
 * matters for mid-stream speech (segments arrive as the assistant is still
 * generating the rest of its response).
 */

import { setup, assign, fromPromise } from "xstate";
import type { SpeechSegment } from "../lib/speech-parsing";
import type { getTTSClient } from "../lib/tts-client";

type TTSClient = ReturnType<typeof getTTSClient>;

interface SpeechPlaybackContext {
  playingMessageId: string | null;
  /** Segments waiting to play. The current one sits at [0] during playback. */
  queue: SpeechSegment[];
  /** Captured when the first PLAY arrives; reused across self-transitions. */
  ttsClient: TTSClient | null;
  onComplete?: () => void;
}

type SpeechPlaybackEvent =
  | { type: "PLAY"; messageId: string; segments: SpeechSegment[]; ttsClient: TTSClient }
  | { type: "STOP"; ttsClient: TTSClient };

const playOneActor = fromPromise(
  async ({
    input,
  }: {
    input: {
      segment: SpeechSegment;
      ttsClient: TTSClient;
    };
  }) => {
    await input.ttsClient.speak(input.segment.text, {
      instructions: input.segment.instructions,
      voice: input.segment.voice,
      overrideInstructions: input.segment.overrideInstructions,
    });
  }
);

export const speechPlaybackMachine = setup({
  types: {
    context: {} as SpeechPlaybackContext,
    events: {} as SpeechPlaybackEvent,
    input: {} as { onComplete?: () => void },
  },
  actors: {
    playOne: playOneActor,
  },
}).createMachine({
  id: "speechPlayback",
  initial: "idle",
  context: ({ input }) => ({
    playingMessageId: null,
    queue: [],
    ttsClient: null,
    onComplete: input.onComplete,
  }),
  states: {
    idle: {
      on: {
        PLAY: {
          target: "playing",
          actions: assign(({ event }) => ({
            playingMessageId: event.messageId,
            queue: [...event.segments],
            ttsClient: event.ttsClient,
          })),
        },
      },
    },
    playing: {
      invoke: {
        src: "playOne",
        input: ({ context }) => ({
          // Non-null assertions are safe: we only enter `playing` via PLAY
          // (populates queue + ttsClient) or a self-transition that
          // preserves them.
          segment: context.queue[0] as SpeechSegment,
          ttsClient: context.ttsClient as TTSClient,
        }),
        onDone: [
          {
            // More segments queued — drop the one we just played and replay
            // the state so the actor re-invokes with the new queue head.
            guard: ({ context }) => context.queue.length > 1,
            target: "playing",
            reenter: true,
            actions: assign(({ context }) => ({
              queue: context.queue.slice(1),
            })),
          },
          {
            target: "idle",
            actions: [
              assign({ queue: [], playingMessageId: null }),
              ({ context }) => {
                context.onComplete?.();
              },
            ],
          },
        ],
        onError: [
          {
            guard: ({ context }) => context.queue.length > 1,
            target: "playing",
            reenter: true,
            actions: [
              ({ event }) => {
                console.error("[speech] segment failed, skipping:", (event as { error?: unknown }).error);
              },
              assign(({ context }) => ({
                queue: context.queue.slice(1),
              })),
            ],
          },
          {
            target: "idle",
            actions: [
              ({ event }) => {
                console.error("[speech] segment failed:", (event as { error?: unknown }).error);
              },
              assign({ queue: [], playingMessageId: null }),
              ({ context }) => {
                context.onComplete?.();
              },
            ],
          },
        ],
      },
      on: {
        // A new PLAY while already playing: append segments to the queue.
        // The current actor finishes its segment, then onDone re-enters
        // this state and picks up the newly queued ones.
        PLAY: {
          actions: assign(({ context, event }) => ({
            queue: [...context.queue, ...event.segments],
            playingMessageId: event.messageId,
          })),
        },
        STOP: {
          target: "idle",
          actions: [
            ({ context, event }) => {
              // Prefer the ttsClient stashed from PLAY, fall back to the
              // one provided with STOP (both should be the same singleton).
              (context.ttsClient ?? event.ttsClient).stop();
            },
            assign({ queue: [], playingMessageId: null }),
          ],
        },
      },
    },
  },
});
