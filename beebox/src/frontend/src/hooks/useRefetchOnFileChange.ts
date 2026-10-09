import { useEffect, useRef } from "react";
import { useBusSubscription } from "./useBusSubscription";

/**
 * Refetch a query after box files change (debounced, one refetch per burst)
 * and on (re)connect. Mount it only where someone is looking: the Properties
 * sections mount only while the back is shown, and the place page only while
 * the landmark card is open.
 */
export function useRefetchOnFileChange(refetch: () => unknown): void {
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pending.current !== null) clearTimeout(pending.current); }, []);
  useBusSubscription({
    onEvent: ({ event }) => {
      if (event !== "file-change" || pending.current !== null) return;
      pending.current = setTimeout(() => { pending.current = null; void refetch(); }, 500);
    },
    onConnect: () => { void refetch(); },
  });
}
