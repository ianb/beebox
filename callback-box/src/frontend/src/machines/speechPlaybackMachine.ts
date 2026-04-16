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
    for (const [i, segment] of input.segments.entries()) {
      const preview = segment.text.slice(0, 60).replace(/\n/g, " ");
      console.log(
        `[speech] segment ${i + 1}/${input.segments.length} starting (voice=${segment.voice ?? "(default)"}, overrideInstructions=${segment.overrideInstructions ? 1 : 0}, instructions=${segment.instructions ? `"${segment.instructions.slice(0, 40)}"` : "(none)"}) text="${preview}"`
      );
      try {
        await input.ttsClient.speak(segment.text, {
          instructions: segment.instructions,
          voice: segment.voice,
          overrideInstructions: segment.overrideInstructions,
        });
        console.log(`[speech] segment ${i + 1}/${input.segments.length} done`);
      } catch (e) {
        // Log + wrap so the machine's onError handler sees a descriptive
        // message identifying which segment failed.
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(
          `[speech] segment ${i + 1}/${input.segments.length} failed: ${msg}`
        );
        throw new Error(`speech segment ${i + 1}/${input.segments.length}: ${msg}`);
      }
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
          actions: assign(({ event }) => {
            console.log(
              `[speech] PLAY idle→playing messageId=${event.messageId} segments=${event.segments.length}`
            );
            return { playingMessageId: event.messageId };
          }),
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
              console.log(`[speech] playing→idle (onDone) messageId=${context.playingMessageId}`);
              context.onComplete?.();
            },
          ],
        },
        onError: {
          target: "idle",
          actions: [
            ({ context, event }) => {
              const err = (event as { error?: unknown }).error;
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(
                `[speech] playing→idle (onError) messageId=${context.playingMessageId} error="${msg}"`
              );
            },
            assign({ playingMessageId: null }),
          ],
        },
      },
      on: {
        // A new PLAY while still playing is dropped silently by xstate
        // (no transition). Log that so we notice if it happens — otherwise
        // the user gets no audio and no feedback.
        PLAY: {
          actions: ({ context, event }) => {
            console.warn(
              `[speech] PLAY dropped — already playing messageId=${context.playingMessageId}, incoming messageId=${event.messageId}`
            );
          },
        },
        STOP: {
          target: "idle",
          actions: [
            ({ context, event }) => {
              console.log(`[speech] playing→idle (STOP) messageId=${context.playingMessageId}`);
              event.ttsClient.stop();
            },
            assign({ playingMessageId: null }),
          ],
        },
      },
    },
  },
});
