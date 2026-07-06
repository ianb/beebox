/**
 * Cross-tab microphone mutual exclusion.
 *
 * Only one tab should hold the mic at a time. When a tab begins recording it
 * "claims" the mic; any other tab currently recording yields (its registered
 * eviction callback fires, stopping its capture). This keeps you from recording
 * in two places at once when chat is open in multiple tabs.
 *
 * Built on BroadcastChannel, which is inherently same-origin: tabs on
 * localhost:3210 and box.example.com never see each other's claims, which is
 * exactly the intended scope.
 */

const CHANNEL_NAME = "callback-mic-lock";

interface ClaimMessage {
  type: "claim";
  /** Identifies the claiming tab so it ignores the echo of its own message. */
  tabId: string;
}

/** Per-tab identity, stable for the life of the document. */
const tabId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

let channel: BroadcastChannel | null = null;
/** Eviction callbacks of holders in *this* tab (normally zero or one). */
const evictListeners = new Set<() => void>();

function ensureChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === "undefined") return null;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<ClaimMessage>) => {
    const msg = event.data;
    if (msg?.type !== "claim" || msg.tabId === tabId) return;
    // Another tab took the mic — yield ours. Copy first: an eviction callback
    // may release itself (mutating the set) as it runs.
    for (const evict of [...evictListeners]) evict();
  };
  return channel;
}

/**
 * Claim the mic for this tab and register `onEvict`, called if another tab
 * later claims it. Returns a release function to call when this tab stops
 * recording (it unregisters the listener; nothing else needs to happen).
 *
 * Call this once when a recording session goes active, and release when it
 * ends — a tab only listens for evictions while it actually holds the mic.
 */
export function claimMicAcrossTabs(onEvict: () => void): () => void {
  const bc = ensureChannel();
  evictListeners.add(onEvict);
  // eslint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel.postMessage takes no targetOrigin (the rule targets window.postMessage)
  bc?.postMessage({ type: "claim", tabId } satisfies ClaimMessage);
  return () => {
    evictListeners.delete(onEvict);
  };
}
