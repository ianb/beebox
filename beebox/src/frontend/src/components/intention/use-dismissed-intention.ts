/**
 * Whether the person hid a place's intention on this device, and the × that
 * hides it (docs/implemented-plans/place-intention.md, Track B). The place page and the
 * strip read the same key, so one × hides both: a write notifies every
 * mounted reader, and another tab's write arrives through the `storage` event.
 * When storage fails the hidden text is kept in memory for this page load.
 */

import { useSyncExternalStore } from "react";
import { isDismissed, readDismissedText, writeDismissedText, type DismissedText } from "../../lib/dismissed-text";

const listeners = new Set<() => void>();
const thisLoad = new Map<string, string>();

function entry(key: string): DismissedText {
  return { storage: () => (typeof localStorage === "undefined" ? null : localStorage), key };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined") window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", listener);
  };
}

/**
 * What this load hid when storage refused the write, else what storage holds.
 * The in-memory value is kept only after a failed write, so it is the newer
 * decision: a stale stored text (reads work, writes fail: a full store) must
 * not keep showing the line the person just hid.
 */
function read(key: string): string | null {
  return thisLoad.get(key) ?? readDismissedText(entry(key));
}

/** The storage key for one place's intention in one box. */
export function intentionDismissKey({ boxSlug, landmarkPath }: { boxSlug: string; landmarkPath: string }): string {
  return `bbx:intention-dismissed:${boxSlug}:${landmarkPath}`;
}

export function useDismissedIntention({ key, text }: { key: string; text: string }): { dismissed: boolean; dismiss: () => void } {
  const stored = useSyncExternalStore(subscribe, () => read(key), () => read(key));
  return {
    dismissed: isDismissed({ stored, text }),
    dismiss: () => {
      if (writeDismissedText(entry(key), text)) thisLoad.delete(key);
      else thisLoad.set(key, text.trim());
      for (const listener of listeners) listener();
    },
  };
}
