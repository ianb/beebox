import { useEffect, useState } from "react";

/**
 * The spoken phrases surfaced to the user, one per rotation. Each is a
 * representative phrasing of an action in speech-keywords.ts — alternates
 * ("start over", "stop listening", "deliver the message") work too but the
 * hint shows one canonical form per action.
 */
const HINTS = ['"send message"', '"mic off"', '"erase message"', '"cancel message"'] as const;
const ROTATE_MS = 10000;

/**
 * Rotating one-phrase reminder of the voice keywords, floated above the
 * composer while the mic is live (pattern borrowed from memory-atlas's
 * speech control). Keeps the keyword set discoverable without a help page:
 * a single quoted phrase at a time, cycling slowly. The parent supplies a
 * `relative` container.
 */
export function KeywordHint() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="absolute bottom-full left-0 mb-1 text-xs text-warm-700 bg-warm-50/90 px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none">
      {HINTS[tick % HINTS.length]}
    </div>
  );
}
