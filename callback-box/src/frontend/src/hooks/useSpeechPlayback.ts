/**
 * Hook for TTS speech playback state management via XState.
 * Adapted from thinking-machine useSpeechPlayback.ts (no earcons).
 */

import { useEffect, useCallback, useRef, useMemo } from "react";
import { useMachine } from "@xstate/react";
import { speechPlaybackMachine } from "../machines/speechPlaybackMachine";
import { getTTSClient } from "../lib/tts-client";
import type { SpeechSegment } from "../lib/speech-parsing";

interface PlaySegmentsOptions {
  messageId: string;
  segments: SpeechSegment[];
}

export interface SpeechPlayback {
  isPlaying: boolean;
  playingMessageId: string | null;
  playSegments: (options: PlaySegmentsOptions) => Promise<void>;
  stop: () => void;
  markAsPlayed: (messageId: string) => void;
}

export interface SpeechPlaybackOptions {
  onComplete?: () => void;
}

export function useSpeechPlayback(options?: SpeechPlaybackOptions): SpeechPlayback {
  const input = useMemo(() => ({ onComplete: options?.onComplete }), [options?.onComplete]);
  const [snapshot, send] = useMachine(speechPlaybackMachine, { input });
  const playedMessagesRef = useRef<Set<string>>(new Set());
  const ttsClient = getTTSClient();

  const isPlaying = snapshot.matches("playing");
  const { playingMessageId } = snapshot.context;

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

  const stop = useCallback(() => {
    send({ type: "STOP", ttsClient });
  }, [ttsClient, send]);

  const markAsPlayed = useCallback((messageId: string) => {
    playedMessagesRef.current.add(messageId);
  }, []);

  return { isPlaying, playingMessageId, playSegments, stop, markAsPlayed };
}
