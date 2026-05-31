/**
 * TTS speech-playback orchestration for InteractiveChat: owns the shared
 * voice refs, the speech-playback handle, the batch-dispatch rules
 * (suppress while composing, pause mic while speaking), and the three
 * effects that drive playback off the stream (mute-stop, mid-stream
 * dispatch, end-of-turn/state-transition dispatch). Returns the refs +
 * the playback handle so the transcription hook can share them.
 */

import { useEffect, useRef, useCallback } from "react";
import { useSpeechPlayback } from "../../hooks/useSpeechPlayback";
import { parseAllSpeechTags, type SpeechSegment } from "../../lib/speech-parsing";
import { recordingStart } from "../../lib/earcons";

interface SnapshotLike {
  value: unknown;
  context: { streamText: string };
}

export interface VoiceRefs {
  turnTakingRef: React.MutableRefObject<boolean>;
  transcriptionRef: React.MutableRefObject<{ start: () => void; cancel: () => void; state: string; transcript: string } | null>;
  stopTickRef: React.MutableRefObject<(() => void) | null>;
  speechPlayedRef: React.MutableRefObject<boolean>;
  voicePausedRef: React.MutableRefObject<boolean>;
}

export type QueueSpeechBatch = (args: { segments: SpeechSegment[]; messageId: string; baseIndex: number }) => boolean;

export function useSpeechDispatch(opts: {
  snapshot: SnapshotLike;
  muted: boolean;
  setVoicePaused: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const { snapshot, muted, setVoicePaused } = opts;

  const turnTakingRef = useRef(false);
  const transcriptionRef = useRef<{ start: () => void; cancel: () => void; state: string; transcript: string } | null>(null);
  const stopTickRef = useRef<(() => void) | null>(null);
  const prevStateRef = useRef<string>("loading");
  const speechPlayedRef = useRef(false);
  const voicePausedRef = useRef(false);

  // Track machine state for use in stable callbacks
  const machineStateRef = useRef(snapshot.value);
  useEffect(() => {
    machineStateRef.current = snapshot.value;
  });

  const speechPlayback = useSpeechPlayback({
    onComplete: () => {
      // Resume recording if it was paused for TTS
      if (voicePausedRef.current) {
        voicePausedRef.current = false;
        setVoicePaused(false);
        transcriptionRef.current?.start();
      } else if (turnTakingRef.current && machineStateRef.current !== "streaming") {
        recordingStart.play();
        transcriptionRef.current?.start();
      }
    },
  });

  // Number of speech segments already dispatched to playback from the
  // current stream. Reset when a new turn starts.
  const playedSegmentCountRef = useRef(0);

  /**
   * Dispatch a batch of new speech segments for playback, applying the
   * "suppress if user is composing voice" and "pause mic while speaking"
   * rules. Returns true if segments were queued (or intentionally
   * suppressed — i.e. handled), false otherwise.
   */
  const queueSpeechBatch = useCallback<QueueSpeechBatch>(
    ({ segments: newSegments, messageId, baseIndex }) => {
      if (newSegments.length === 0) return false;

      speechPlayedRef.current = true;

      if (muted) {
        speechPlayback.markAsPlayed(messageId);
        return true;
      }

      // Suppress TTS if user has in-progress voice text
      const hasActiveTranscript = transcriptionRef.current &&
        transcriptionRef.current.transcript.trim().length > 0;
      if (hasActiveTranscript) {
        speechPlayback.markAsPlayed(messageId);
        return true;
      }

      // Pause recording while TTS plays
      if (transcriptionRef.current && transcriptionRef.current.state === "recording") {
        voicePausedRef.current = true;
        queueMicrotask(() => setVoicePaused(true));
        transcriptionRef.current.cancel();
      }

      speechPlayback.playSegments({ messageId, segments: newSegments, baseIndex });
      return true;
    },
    [speechPlayback, muted, setVoicePaused]
  );

  // Stop any in-flight speech the moment mute is engaged.
  useEffect(() => {
    if (muted) speechPlayback.stop();
  }, [muted, speechPlayback]);

  // Mid-stream: play complete <speech>...</speech> segments as they arrive.
  // Counts closing </speech> tags to avoid parsing a half-received segment.
  useEffect(() => {
    if (snapshot.value !== "streaming") return;
    const text = snapshot.context.streamText;
    const closedMatches = text.match(/<\/speech>/gi);
    const closedCount = closedMatches ? closedMatches.length : 0;
    if (closedCount <= playedSegmentCountRef.current) return;

    const allSegments = parseAllSpeechTags(text);
    // parseAllSpeechTags may include a still-open tag at the end; clip to
    // the number of actual closing tags so we only dispatch fully-closed
    // segments.
    const complete = allSegments.slice(0, closedCount);
    const newSegments = complete.slice(playedSegmentCountRef.current);
    if (newSegments.length === 0) {
      // Closing tag count advanced but parser didn't surface new segments
      // (e.g. nested tags); sync the counter and move on.
      playedSegmentCountRef.current = closedCount;
      return;
    }

    const messageId = `stream-${Date.now()}-${playedSegmentCountRef.current}`;
    queueSpeechBatch({ segments: newSegments, messageId, baseIndex: playedSegmentCountRef.current });
    playedSegmentCountRef.current = closedCount;
  }, [snapshot.value, snapshot.context.streamText, queueSpeechBatch]);

  // Handle state transitions: play any final speech, mic restart after refresh
  useEffect(() => {
    const current = snapshot.value as string;
    const prev = prevStateRef.current;
    prevStateRef.current = current;

    // Entering streaming: reset the mid-stream played counter for the new turn
    if (current === "streaming" && prev !== "streaming") {
      playedSegmentCountRef.current = 0;
    }

    // streaming → refreshing: stop tick, play any segments that didn't
    // get dispatched mid-stream (rare — parser behavior or last-tick
    // tail from the final message).
    if (current === "refreshing" && prev === "streaming") {
      if (stopTickRef.current) {
        stopTickRef.current();
        stopTickRef.current = null;
      }
      const allSegments = parseAllSpeechTags(snapshot.context.streamText);
      const remaining = allSegments.slice(playedSegmentCountRef.current);
      if (allSegments.length > 0) speechPlayedRef.current = true;
      if (remaining.length > 0) {
        queueSpeechBatch({ segments: remaining, messageId: `stream-end-${Date.now()}`, baseIndex: playedSegmentCountRef.current });
        playedSegmentCountRef.current = allSegments.length;
      }
    }

    // refreshing → idle: restart mic for non-speech responses
    if (current === "idle" && prev === "refreshing") {
      if (!speechPlayedRef.current && turnTakingRef.current) {
        // Only restart if not already recording (might be paused/resumed by TTS logic)
        if (!voicePausedRef.current) {
          recordingStart.play();
          transcriptionRef.current?.start();
        }
      }
    }
  }, [snapshot.value, snapshot.context.streamText, queueSpeechBatch]);

  const refs: VoiceRefs = { turnTakingRef, transcriptionRef, stopTickRef, speechPlayedRef, voicePausedRef };
  return { speechPlayback, queueSpeechBatch, refs };
}
