import { useEffect, useState } from "react";

/**
 * Spoken phrases surfaced while there's transcribed text to act on — each a
 * representative phrasing of an action in speech-keywords.ts (alternates like
 * "start over", "stop listening", "deliver the message" work too). Ordered so
 * the rotation leads with the one the user most likely wants next.
 */
const WITH_TEXT_HINTS = ['"send message"', '"erase message"', '"cancel message"', '"microphone off"'] as const;
/** Before anything is said, only ending the session is meaningful. */
const EMPTY_HINTS = ['"microphone off"'] as const;
const ROTATE_MS = 10000;

/**
 * Rotating one-phrase reminder of the voice keywords, shown while the mic
 * is live (pattern borrowed from memory-atlas's speech control). Keeps the
 * keyword set discoverable without a help page: a single quoted phrase at a
 * time, cycling slowly, filtered to what's actually valid — send/erase/
 * cancel only appear once there's text for them to act on. Positioned by
 * MicOverlay alongside the volume bars.
 */
export function KeywordHint({ hasText }: { hasText: boolean }) {
  const [tick, setTick] = useState(0);

  // Restart the cycle when the context flips so the first hint shown is the
  // list's most useful one ("send message" as soon as there's text), not an
  // arbitrary mid-rotation entry.
  useEffect(() => {
    setTick(0);
    const id = setInterval(() => setTick((t) => t + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, [hasText]);

  const hints = hasText ? WITH_TEXT_HINTS : EMPTY_HINTS;
  return (
    <div className="text-xs text-warm-700 bg-warm-50/90 px-1.5 py-0.5 rounded whitespace-nowrap">
      {hints[tick % hints.length]}
    </div>
  );
}
