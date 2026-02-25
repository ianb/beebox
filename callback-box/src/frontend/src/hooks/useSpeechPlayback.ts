/**
 * Hook for TTS speech playback state management.
 * Adapted from thinking-machine useSpeechPlayback.ts (no earcons).
 */

import { useState, useEffect, useCallback, useRef } from "react";
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const playedMessagesRef = useRef<Set<string>>(new Set());
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const ttsClient = getTTSClient();

  useEffect(() => {
    ttsClient.setOnPlayingChange(setIsPlaying);
  }, [ttsClient]);

  // Escape key stops playback
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape" && isPlaying) {
        e.preventDefault();
        ttsClient.stop();
        setPlayingMessageId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, ttsClient]);

  const playSegments = useCallback(
    async ({ messageId, segments }: PlaySegmentsOptions) => {
      if (playedMessagesRef.current.has(messageId)) return;
      playedMessagesRef.current.add(messageId);
      setPlayingMessageId(messageId);

      try {
        for (const segment of segments) {
          await ttsClient.speak(segment.text, segment.instructions);
        }
        optionsRef.current?.onComplete?.();
      } catch (error) {
        if ((error as Error).message !== "Playback stopped") {
          console.error("[Speech] Playback error:", error);
        }
      } finally {
        setPlayingMessageId(null);
      }
    },
    [ttsClient]
  );

  const stop = useCallback(() => {
    ttsClient.stop();
    setPlayingMessageId(null);
  }, [ttsClient]);

  const markAsPlayed = useCallback((messageId: string) => {
    playedMessagesRef.current.add(messageId);
  }, []);

  return { isPlaying, playingMessageId, playSegments, stop, markAsPlayed };
}
