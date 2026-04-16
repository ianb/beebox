/**
 * XState machine for TTS speech playback.
 *
 * States: idle → playing → idle
 *
 * The TTS client is an external service passed as input.
 * The machine tracks playback state; the played-messages Set
 * stays in the hook wrapper (UI bookkeeping, not machine state).
 */

import { setup, assign, fromPromise } from "xstate";
import type { SpeechSegment } from "../lib/speech-parsing";
import type { getTTSClient } from "../lib/tts-client";

type TTSClient = ReturnType<typeof getTTSClient>;

interface SpeechPlaybackContext {
  playingMessageId: string | null;
  onComplete?: () => void;
}

type SpeechPlaybackEvent =
  | { type: "PLAY"; messageId: string; segments: SpeechSegment[]; ttsClient: TTSClient }
  | { type: "STOP"; ttsClient: TTSClient };

const playSegmentsActor = fromPromise(
  async ({
    input,
  }: {
    input: {
      segments: SpeechSegment[];
      ttsClient: TTSClient;
    };
  }) => {
    for (const segment of input.segments) {
      await input.ttsClient.speak(segment.text, {
        instructions: segment.instructions,
        voice: segment.voice,
        overrideInstructions: segment.overrideInstructions,
      });
    }
  }
);

export const speechPlaybackMachine = setup({
  types: {
    context: {} as SpeechPlaybackContext,
    events: {} as SpeechPlaybackEvent,
    input: {} as { onComplete?: () => void },
  },
  actors: {
    playSegments: playSegmentsActor,
  },
}).createMachine({
  id: "speechPlayback",
  initial: "idle",
  context: ({ input }) => ({
    playingMessageId: null,
    onComplete: input.onComplete,
  }),
  states: {
    idle: {
      on: {
        PLAY: {
          target: "playing",
          actions: assign(({ event }) => ({
            playingMessageId: event.messageId,
          })),
        },
      },
    },
    playing: {
      invoke: {
        src: "playSegments",
        input: ({ event }) => {
          const playEvent = event as Extract<SpeechPlaybackEvent, { type: "PLAY" }>;
          return {
            segments: playEvent.segments,
            ttsClient: playEvent.ttsClient,
          };
        },
        onDone: {
          target: "idle",
          actions: [
            assign({ playingMessageId: null }),
            ({ context }) => {
              context.onComplete?.();
            },
          ],
        },
        onError: {
          target: "idle",
          actions: assign({ playingMessageId: null }),
        },
      },
      on: {
        STOP: {
          target: "idle",
          actions: [
            ({ event }) => {
              event.ttsClient.stop();
            },
            assign({ playingMessageId: null }),
          ],
        },
      },
    },
  },
});
