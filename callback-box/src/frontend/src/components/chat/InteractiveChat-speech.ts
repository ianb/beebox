/**
 * TTS speech-dispatch for InteractiveChat: owns the speech-playback handle and
 * the effects that turn the assistant's streamed `<speech>` tags into playback
 * requests. The "should this play / pause the mic / be suppressed" decisions no
 * longer live here — they belong to `composerMachine`. This hook just parses
 * the stream and raises `SPEECH_QUEUED` / `SPEECH_DONE` (plus the post-reply
 * mic reopen) into that machine.
 */

import { useEffect, useRef, useCallback } from "react";
import { useSpeechPlayback } from "../../hooks/useSpeechPlayback";
import { parseAllSpeechTags } from "../../lib/speech-parsing";
import type { ComposerEvent } from "../../machines/composerMachine";

interface SnapshotLike {
  value: unknown;
  context: { streamText: string };
}

interface ComposerSnapshotLike {
  context: { turnTaking: boolean };
  matches: (state: { voice: "idle" | "speaking" | "pausedForSpeech" }) => boolean;
}

export function useSpeechDispatch(opts: {
  snapshot: SnapshotLike;
  composerSnapshot: ComposerSnapshotLike;
  composerSend: (event: ComposerEvent) => void;
}) {
  const { snapshot, composerSnapshot, composerSend } = opts;

  // Tick earcon handle, armed by the keyword-send commit and silenced when the
  // turn ends. Shared with the voice hook (which arms it).
  const stopTickRef = useRef<(() => void) | null>(null);
  // Did the current turn produce any speech? Gates the post-reply mic reopen —
  // a spoken reply already hands the turn back via SPEECH_DONE.
  const speechPlayedRef = useRef(false);
  const prevStateRef = useRef<string>("loading");
  // Number of speech segments already dispatched from the current stream.
  const playedSegmentCountRef = useRef(0);

  // Keep the latest composer snapshot readable inside effects without making
  // them depend on every machine transition.
  const composerSnapshotRef = useRef(composerSnapshot);
  useEffect(() => { composerSnapshotRef.current = composerSnapshot; });

  // Stable identity so useSpeechPlayback's machine-input memo doesn't recompute
  // every render (it keys on onComplete).
  const handleSpeechComplete = useCallback(() => { composerSend({ type: "SPEECH_DONE" }); }, [composerSend]);
  const speechPlayback = useSpeechPlayback({ onComplete: handleSpeechComplete });

  const dispatch = useCallback((segments: ReturnType<typeof parseAllSpeechTags>, baseIndex: number) => {
    if (segments.length === 0) return;
    speechPlayedRef.current = true;
    composerSend({ type: "SPEECH_QUEUED", messageId: `stream-${Date.now()}-${baseIndex}`, segments, baseIndex });
  }, [composerSend]);

  // Mid-stream: dispatch complete <speech>...</speech> segments as they arrive.
  // Counts closing </speech> tags to avoid parsing a half-received segment.
  useEffect(() => {
    if (snapshot.value !== "streaming") return;
    const text = snapshot.context.streamText;
    const closedMatches = text.match(/<\/speech>/gi);
    const closedCount = closedMatches ? closedMatches.length : 0;
    if (closedCount <= playedSegmentCountRef.current) return;

    const allSegments = parseAllSpeechTags(text);
    const complete = allSegments.slice(0, closedCount);
    const newSegments = complete.slice(playedSegmentCountRef.current);
    if (newSegments.length === 0) {
      playedSegmentCountRef.current = closedCount;
      return;
    }
    dispatch(newSegments, playedSegmentCountRef.current);
    playedSegmentCountRef.current = closedCount;
  }, [snapshot.value, snapshot.context.streamText, composerSend, dispatch]);

  // State transitions: reset per-turn counter, flush trailing speech, reopen
  // the mic after a non-speech reply.
  useEffect(() => {
    const current = snapshot.value as string;
    const prev = prevStateRef.current;
    prevStateRef.current = current;

    if (current === "streaming" && prev !== "streaming") {
      playedSegmentCountRef.current = 0;
    }

    // streaming → refreshing: stop tick, dispatch any segments that didn't get
    // sent mid-stream (parser tail / final message).
    if (current === "refreshing" && prev === "streaming") {
      if (stopTickRef.current) {
        stopTickRef.current();
        stopTickRef.current = null;
      }
      const allSegments = parseAllSpeechTags(snapshot.context.streamText);
      const remaining = allSegments.slice(playedSegmentCountRef.current);
      if (allSegments.length > 0) speechPlayedRef.current = true;
      if (remaining.length > 0) {
        dispatch(remaining, playedSegmentCountRef.current);
        playedSegmentCountRef.current = allSegments.length;
      }
    }

    // refreshing → idle: reopen the mic for a non-speech reply when a voice
    // conversation is active and nothing is currently playing. A spoken reply
    // instead hands the mic back via SPEECH_DONE.
    if (current === "idle" && prev === "refreshing") {
      const cs = composerSnapshotRef.current;
      if (!speechPlayedRef.current && cs.context.turnTaking && cs.matches({ voice: "idle" })) {
        composerSend({ type: "START_DICTATION" });
      }
      speechPlayedRef.current = false;
    }
  }, [snapshot.value, snapshot.context.streamText, composerSend, dispatch]);

  return { speechPlayback, stopTickRef, speechPlayedRef };
}
