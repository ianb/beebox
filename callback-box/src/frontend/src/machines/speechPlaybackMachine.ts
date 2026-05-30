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
 *
 * Each non-head queue item also carries an in-flight prefetch handle (when
 * `shouldPrefetchSpeech()` is true), so the network fetch for the next
 * segment runs in parallel with playback of the current one. Eliminates the
 * inter-segment gap caused by sequential fetch-then-play.
 */

import { setup, assign, fromPromise } from "xstate";
import { shouldPrefetchSpeech } from "../lib/audio-context";
import type { SpeechSegment } from "../lib/speech-parsing";
import type { getTTSClient, PrefetchHandle } from "../lib/tts-client";

type TTSClient = ReturnType<typeof getTTSClient>;

interface QueueItem {
  segment: SpeechSegment;
  prefetch: PrefetchHandle | null;
  /** Absolute index of this segment within its message (for the now-playing highlight). */
  index: number;
}

interface SpeechPlaybackContext {
  playingMessageId: string | null;
  /** Items waiting to play. The current one sits at [0] during playback. */
  queue: QueueItem[];
  /** Captured when the first PLAY arrives; reused across self-transitions. */
  ttsClient: TTSClient | null;
  onComplete?: () => void;
}

type SpeechPlaybackEvent =
  | { type: "PLAY"; messageId: string; segments: SpeechSegment[]; baseIndex: number; ttsClient: TTSClient }
  | { type: "STOP"; ttsClient: TTSClient };

function speechOptions(segment: SpeechSegment) {
  return {
    instructions: segment.instructions,
    voice: segment.voice,
    overrideInstructions: segment.overrideInstructions,
  };
}

/**
 * Wrap segments into QueueItems, kicking off prefetches for any whose final
 * queue index will be >= 1 (i.e., not the immediate head).
 *
 * `queueOffset` is the index where the first new segment lands in the
 * resulting queue. 0 means the first segment will become the playing head
 * (don't prefetch it). >0 means all new segments sit behind a currently-
 * playing item (prefetch all of them).
 */
function buildQueueItems(
  segments: SpeechSegment[],
  { ttsClient, queueOffset, baseIndex }: { ttsClient: TTSClient; queueOffset: number; baseIndex: number },
): QueueItem[] {
  const prefetchEnabled = shouldPrefetchSpeech();
  return segments.map((segment, i) => ({
    segment,
    index: baseIndex + i,
    prefetch:
      prefetchEnabled && queueOffset + i >= 1
        ? ttsClient.prefetch(segment.text, speechOptions(segment))
        : null,
  }));
}

function abortPending(items: QueueItem[]): void {
  for (const item of items) {
    item.prefetch?.abort();
  }
}

const playOneActor = fromPromise(
  async ({
    input,
  }: {
    input: {
      item: QueueItem;
      ttsClient: TTSClient;
    };
  }) => {
    await input.ttsClient.speak(input.item.segment.text, {
      ...speechOptions(input.item.segment),
      prefetch: input.item.prefetch ?? undefined,
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
            queue: buildQueueItems(event.segments, { ttsClient: event.ttsClient, queueOffset: 0, baseIndex: event.baseIndex }),
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
          item: context.queue[0] as QueueItem,
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
              ({ event, context }) => {
                console.error("[speech] segment failed:", (event as { error?: unknown }).error);
                abortPending(context.queue.slice(1));
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
        // this state and picks up the newly queued ones. All appended items
        // sit behind the current head, so prefetch every one of them.
        PLAY: {
          actions: assign(({ context, event }) => ({
            queue: [
              ...context.queue,
              ...buildQueueItems(event.segments, {
                ttsClient: event.ttsClient,
                queueOffset: context.queue.length,
                baseIndex: event.baseIndex,
              }),
            ],
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
              abortPending(context.queue.slice(1));
            },
            assign({ queue: [], playingMessageId: null }),
          ],
        },
      },
    },
  },
});
