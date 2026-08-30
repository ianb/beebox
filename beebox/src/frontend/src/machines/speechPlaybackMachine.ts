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
import { shouldPrefetchSpeech } from "../lib/audio/context";
import type { SpeechSegment } from "../lib/audio/speech-parsing";
import type { getTTSClient, PrefetchHandle } from "../lib/audio/tts-client";

type TTSClient = ReturnType<typeof getTTSClient>;

class EmptySpeechQueueError extends Error {
  constructor() {
    super("Speech playback entered playing with an empty queue");
    this.name = "EmptySpeechQueueError";
  }
}

class MissingTTSClientError extends Error {
  constructor() {
    super("Speech playback entered playing without a TTS client");
    this.name = "MissingTTSClientError";
  }
}

interface QueueItem {
  segment: SpeechSegment;
  prefetch: PrefetchHandle | null;
  /** Absolute index of this segment within its message (for the now-playing highlight). */
  index: number;
}

export type SpeechSegmentState = "waiting" | "playing" | "failed";

interface SpeechPlaybackContext {
  playingMessageId: string | null;
  /** Message whose segment progress remains visible, including sticky failures. */
  statusMessageId: string | null;
  /** Absolute segment index → visible progress state. Successful segments disappear. */
  segmentStates: Record<number, SpeechSegmentState>;
  /** Items waiting to play. The current one sits at [0] during playback. */
  queue: QueueItem[];
  /** Captured when the first PLAY arrives; reused across self-transitions. */
  ttsClient: TTSClient | null;
  onComplete?: () => void;
}

type SpeechPlaybackEvent =
  | { type: "PLAY"; messageId: string; segments: SpeechSegment[]; baseIndex: number; ttsClient: TTSClient }
  | { type: "SEGMENT_PLAYING"; index: number }
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
      prefetchEnabled && queueOffset + i >= 1 && segment.text.trim().length > 0
        ? ttsClient.prefetch(segment.text, speechOptions(segment))
        : null,
  }));
}

function abortPending(items: QueueItem[]): void {
  for (const item of items) {
    item.prefetch?.abort();
  }
}

function waitingStates(items: QueueItem[]): Record<number, SpeechSegmentState> {
  return Object.fromEntries(items.map((item) => [item.index, "waiting"]));
}

function withoutSegment(
  states: Record<number, SpeechSegmentState>,
  index: number,
): Record<number, SpeechSegmentState> {
  const next = { ...states };
  delete next[index];
  return next;
}

function failedSegment(
  states: Record<number, SpeechSegmentState>,
  index: number,
): Record<number, SpeechSegmentState> {
  return { ...states, [index]: "failed" };
}

function onlyFailures(
  states: Record<number, SpeechSegmentState>,
): Record<number, SpeechSegmentState> {
  return Object.fromEntries(
    Object.entries(states).filter(([, state]) => state === "failed"),
  );
}

function hasFailures(states: Record<number, SpeechSegmentState>): boolean {
  return Object.values(states).includes("failed");
}

function currentQueueIndex(queue: QueueItem[]): number {
  const item = queue[0];
  if (item === undefined) throw new EmptySpeechQueueError();
  return item.index;
}

const playOneActor = fromPromise(
  async ({
    input,
  }: {
    input: {
      item: QueueItem;
      ttsClient: TTSClient;
      onPlaybackStarted: () => void;
    };
  }) => {
    // A segment can be empty after redacted-content stripping; skip the TTS
    // call but keep the queue slot so segment indexes stay aligned.
    if (input.item.segment.text.trim().length === 0) return;
    await input.ttsClient.speak(input.item.segment.text, {
      ...speechOptions(input.item.segment),
      prefetch: input.item.prefetch ?? undefined,
      onPlaybackStarted: input.onPlaybackStarted,
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
    statusMessageId: null,
    segmentStates: {},
    queue: [],
    ttsClient: null,
    onComplete: input.onComplete,
  }),
  states: {
    idle: {
      on: {
        PLAY: {
          target: "playing",
          actions: assign(({ event }) => {
            const queue = buildQueueItems(
              event.segments,
              { ttsClient: event.ttsClient, queueOffset: 0, baseIndex: event.baseIndex },
            );
            return {
              playingMessageId: event.messageId,
              statusMessageId: event.messageId,
              segmentStates: waitingStates(queue),
              queue,
              ttsClient: event.ttsClient,
            };
          }),
        },
      },
    },
    playing: {
      invoke: {
        src: "playOne",
        input: ({ context, self }) => {
          // We only enter `playing` via PLAY (populates queue + ttsClient) or a
          // self-transition that preserves them, so both are always present —
          // assert the invariant rather than cast past the optional types.
          const item = context.queue[0];
          const { ttsClient } = context;
          if (item === undefined) throw new EmptySpeechQueueError();
          if (ttsClient === null) throw new MissingTTSClientError();
          return {
            item,
            ttsClient,
            onPlaybackStarted: () => {
              self.send({ type: "SEGMENT_PLAYING", index: item.index });
            },
          };
        },
        onDone: [
          {
            // More segments queued — drop the one we just played and replay
            // the state so the actor re-invokes with the new queue head.
            guard: ({ context }) => context.queue.length > 1,
            target: "playing",
            reenter: true,
            actions: assign(({ context }) => ({
              queue: context.queue.slice(1),
              segmentStates: withoutSegment(
                context.segmentStates,
                currentQueueIndex(context.queue),
              ),
            })),
          },
          {
            target: "idle",
            actions: [
              assign(({ context }) => {
                const segmentStates = withoutSegment(
                  context.segmentStates,
                  currentQueueIndex(context.queue),
                );
                return {
                  queue: [],
                  playingMessageId: null,
                  statusMessageId: hasFailures(segmentStates)
                    ? context.statusMessageId
                    : null,
                  segmentStates,
                };
              }),
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
                console.error("[speech] segment failed, skipping:", event.error);
              },
              assign(({ context }) => ({
                queue: context.queue.slice(1),
                segmentStates: failedSegment(
                  context.segmentStates,
                  currentQueueIndex(context.queue),
                ),
              })),
            ],
          },
          {
            target: "idle",
            actions: [
              ({ event, context }) => {
                console.error("[speech] segment failed:", event.error);
                abortPending(context.queue.slice(1));
              },
              assign(({ context }) => ({
                queue: [],
                playingMessageId: null,
                segmentStates: failedSegment(
                  context.segmentStates,
                  currentQueueIndex(context.queue),
                ),
              })),
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
          actions: assign(({ context, event }) => {
            const added = buildQueueItems(event.segments, {
              ttsClient: event.ttsClient,
              queueOffset: context.queue.length,
              baseIndex: event.baseIndex,
            });
            return {
              queue: [...context.queue, ...added],
              playingMessageId: event.messageId,
              statusMessageId: event.messageId,
              segmentStates: {
                ...context.segmentStates,
                ...waitingStates(added),
              },
            };
          }),
        },
        SEGMENT_PLAYING: {
          actions: assign(({ context, event }) => ({
            segmentStates: {
              ...context.segmentStates,
              [event.index]: "playing",
            },
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
            assign(({ context }) => {
              const segmentStates = onlyFailures(context.segmentStates);
              return {
                queue: [],
                playingMessageId: null,
                statusMessageId: hasFailures(segmentStates)
                  ? context.statusMessageId
                  : null,
                segmentStates,
              };
            }),
          ],
        },
      },
    },
  },
});
