/**
 * "Watching: Water check" above the composer: the person sees that something
 * is watching what they do in the companion view, and whether it works. Per
 * session, so it stays when the companion pane closes. Refetched on
 * `trigger-changed` and on the person's own messages (`trigger-status-store`).
 * No popover: the agent has `bbx chat trigger list` and `log`.
 */

import { useEffect } from "react";
import { trpc } from "../../../../lib/trpc/client";
import { triggerStatusLines } from "./trigger-status";
import { useTriggerVersion } from "./trigger-status-store";

export function TriggerStatusLine({ sessionId }: { sessionId: string | null }) {
  const version = useTriggerVersion(sessionId);
  const query = trpc.triggers.list.useQuery({ session: sessionId ?? "" }, { enabled: sessionId !== null, staleTime: Infinity });
  const refetch = query.refetch;
  useEffect(() => {
    if (sessionId !== null && version > 0) void refetch();
  }, [version, sessionId, refetch]);
  const lines = triggerStatusLines(query.data ?? []);
  if (lines.length === 0) return null;
  return (
    <div className="bbx-trigger-status mx-auto w-full max-w-2xl px-3 pb-1 text-xs text-card-soft" data-testid="trigger-status" aria-live="polite">
      {lines.map((line) => <div key={line} className="truncate">{line}</div>)}
    </div>
  );
}
