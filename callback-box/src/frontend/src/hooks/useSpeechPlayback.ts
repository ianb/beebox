/**
 * Hook for TTS speech playback state management via XState.
 * Adapted from thinking-machine useSpeechPlayback.ts (no earcons).
 */

import { useEffect, useCallback, useRef, useMemo } from "react";
import { useSSRMachine } from "./useSSRMachine";
import { speechPlaybackMachine } from "../machines/speechPlaybackMachine";
import { getTTSClient } from "../lib/tts-client";
import { logSpeechEvent } from "../lib/speech-test-log";
import type { SpeechSegment } from "../lib/speech-parsing";

interface PlaySegmentsOptions {
  messageId: string;
  segments: SpeechSegment[];
}

interface ReplayOptions {
  messageId: string;
  segments: SpeechSegment[];
  /** Index of the first segment to play. Default 0 (replay everything). */
  fromIndex?: number;
}

export interface SpeechPlayback {
  isPlaying: boolean;
  playingMessageId: string | null;
  /** Segments still queued, including the one currently playing. */
  remainingCount: number;
  playSegments: (options: PlaySegmentsOptions) => Promise<void>;
  /** Fast-forward: end the current segment and advance to the next. */
  skip: () => void;
  /** Restart playback of a message's segments from a given index. */
  replay: (options: ReplayOptions) => void;
  stop: () => void;
  markAsPlayed: (messageId: string) => void;
}

export interface SpeechPlaybackOptions {
  onComplete?: () => void;
}

export function useSpeechPlayback(options?: SpeechPlaybackOptions): SpeechPlayback {
  const input = useMemo(() => ({ onComplete: options?.onComplete }), [options?.onComplete]);
  const [snapshot, send] = useSSRMachine(speechPlaybackMachine, { input });
  const playedMessagesRef = useRef<Set<string>>(new Set());
  const ttsClient = getTTSClient();

  const isPlaying = snapshot.matches("playing");
  const { playingMessageId } = snapshot.context;
  const remainingCount = snapshot.context.queue.length;

  // Escape key stops playback
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape" && isPlaying) {
        e.preventDefault();
        send({ type: "STOP", ttsClient });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, ttsClient, send]);

  const playSegments = useCallback(
    async ({ messageId, segments }: PlaySegmentsOptions) => {
      if (playedMessagesRef.current.has(messageId)) return;
      playedMessagesRef.current.add(messageId);
      send({ type: "PLAY", messageId, segments, ttsClient });
    },
    [ttsClient, send]
  );

  const skip = useCallback(() => {
    ttsClient.skipCurrent();
  }, [ttsClient]);

  const replay = useCallback(
    ({ messageId, segments, fromIndex }: ReplayOptions) => {
      const start = fromIndex === undefined ? 0 : fromIndex;
      const slice = segments.slice(start);
      if (slice.length === 0) return;
      logSpeechEvent("replay", { fromIndex: start, count: slice.length });
      // Interrupt whatever is playing, then start the chosen slice fresh.
      // Bypasses the played-message dedupe in playSegments so replay always
      // works, even for a message we already auto-played once.
      send({ type: "STOP", ttsClient });
      send({ type: "PLAY", messageId, segments: slice, ttsClient });
    },
    [ttsClient, send]
  );

  const stop = useCallback(() => {
    send({ type: "STOP", ttsClient });
  }, [ttsClient, send]);

  const markAsPlayed = useCallback((messageId: string) => {
    playedMessagesRef.current.add(messageId);
  }, []);

  return { isPlaying, playingMessageId, remainingCount, playSegments, skip, replay, stop, markAsPlayed };
}
