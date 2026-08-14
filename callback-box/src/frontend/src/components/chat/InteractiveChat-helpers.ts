/**
 * Pure helpers and shared constants for InteractiveChat and its sibling
 * modules. No JSX, no React hooks — just string/number formatting and id
 * minting. Kept separate so the controls,
 * composer, and message-list siblings can share them without a value
 * import cycle through the main component.
 */

import { applySelections, type SelectionItem } from "../../lib/selection/serialize";

/**
 * Format the current local time as HH:MM for the typed/speech tag.
 */
export function localTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/**
 * Build a `<speech>` message, folding any attached selections into the body
 * via the shared serializer (spoken text carries no `[selectionN]` tokens, so
 * every selection is appended). `attrs` is the caller-built attribute string
 * (` local-time="…"` plus the optional zoomed-view/time-passed attributes).
 */
export function buildSpeechMessage(opts: {
  text: string;
  diarized: boolean;
  selections: SelectionItem[];
  attrs: string;
}): string {
  const { text, diarized, selections, attrs } = opts;
  const diarizedAttr = diarized ? " diarized=\"1\"" : "";
  const body = applySelections(text, { selections });
  return `<speech${diarizedAttr}${attrs}>${body}</speech>`;
}

/**
 * Join the composer's prior text with a voice transcript, single-spaced. When
 * a recording is started while the composer already holds text (a previous
 * stopped segment, or typing), the new segment continues from that text
 * instead of discarding it. Mirrors the existing manual-stop append so the
 * displayed value and the committed value always agree.
 */
export function joinTranscript(priorInput: string, transcript: string): string {
  if (!priorInput) return transcript;
  if (!transcript) return priorInput;
  return `${priorInput} ${transcript}`;
}

// Minted at SEND-dispatch time and threaded through to /chat/send so the
// backend's processedMessageIds dedupe (chat.ts:269-284) catches the case
// where the streamActor body runs twice for one logical send (StrictMode
// double-mount, accidental double-dispatch, etc.).
export function newMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function composerTextareaClasses({ mobile, isTranscribing }: { mobile: boolean; isTranscribing: boolean }): string {
  const sizeClass = mobile ? "text-base" : "text-sm min-w-0";
  const stateClass = isTranscribing
    ? "bg-white text-warm-800 border-primary/40 shadow-[0_0_0_1px_rgba(56,149,211,0.08)]"
    : "bg-white border-warm-400";
  return `flex-1 resize-none rounded-lg px-3 py-2 ${sizeClass} ${stateClass} focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent placeholder:text-warm-500`;
}

/**
 * Format a millisecond gap as "Xh" or "XdYh" (hours omitted when zero).
 * Returns null when the gap is under 6 hours — callers should omit the attribute then.
 */
export function formatTimePassed(ms: number): string | null {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  if (ms < SIX_HOURS) return null;
  const totalHours = Math.floor(ms / (60 * 60 * 1000));
  if (totalHours < 24) return `${totalHours}h`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days}d${hours}h` : `${days}d`;
}

/**
 * Ephemeral marker shown in the message stream when the user switches models.
 * `afterGroupCount` snapshots the number of message groups at insertion time
 * — the marker renders between that group and whatever comes after, which
 * gives chronological ordering relative to later-arriving messages.
 * Not persisted: these disappear on page reload.
 */
export interface ModelMarker {
  id: string;
  label: string;
  afterGroupCount: number;
}

/**
 * Type guard for the `chat-features-changed` SSE event payload. Returns
 * the narrowed payload if shape matches, otherwise null — keeps the
 * `event.data: unknown` from the SSE machine type-safe at the use site.
 */
function parseFeaturesChangedPayload(
  data: unknown,
): { sessionId: string; features: Record<string, string> } | null {
  function reject(reason: string): null {
    // Server contract violation — log so it doesn't slip past in production.
    console.warn(`[chat] chat-features-changed payload rejected: ${reason}`);
    return null;
  }
  if (data === null || typeof data !== "object") return reject("not an object");
  if (!("sessionId" in data) || typeof data.sessionId !== "string") return reject("missing sessionId");
  if (!("features" in data) || data.features === null || typeof data.features !== "object") {
    return reject("missing features");
  }
  const features: Record<string, string> = {};
  for (const [k, v] of Object.entries(data.features)) {
    if (typeof v === "string") features[k] = v;
    else console.warn(`[chat] chat-features-changed: dropping non-string value for ${k}`);
  }
  return { sessionId: data.sessionId, features };
}

/**
 * Apply a chat-features-changed payload to local state if the session id
 * matches (or no session id filter is in effect). Module-scoped so the
 * SSE dispatcher useCallback can stay under the complexity budget.
 */
export function applyFeaturesChange(opts: {
  data: unknown;
  currentSessionId: string | null;
  setFeatures: (features: Record<string, string>) => void;
}): void {
  const payload = parseFeaturesChangedPayload(opts.data);
  if (!payload) return;
  if (opts.currentSessionId && payload.sessionId !== opts.currentSessionId) return;
  opts.setFeatures(payload.features);
}
