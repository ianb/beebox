/**
 * The last-result glyph for a scheduled task: success, nothing to do (a
 * deferral that found no work), deferred (engine unavailable), inconclusive (work ran, review reached no verdict), failure,
 * or never run. Click expands the concise error/detail text.
 */

import { InlineAction } from "../../ui/InlineAction";
import { conciseScheduleError } from "@shared/schedule-error";
import type { RouterOutput } from "../../../lib/trpc/client";
import { idleLabel } from "./idle";

type ScheduleInfo = RouterOutput["scheduler"]["schedules"]["schedules"][number];

export function ScheduleStatusIndicator({ lastResult, lastError, lastDeferReason, onToggleError }: { lastResult: ScheduleInfo["lastResult"]; lastError: string | null; lastDeferReason: ScheduleInfo["lastDeferReason"]; onToggleError?: () => void }) {
  const idle = idleLabel(lastResult, lastDeferReason);
  // Found nothing to do: the quiet, healthy case. Nothing to expand.
  if (idle !== null) return <span className="text-warm-500 text-xs">{idle}</span>;
  const errorSummary = lastError === null ? null : conciseScheduleError(lastError);
  if (lastResult === "success") {
    return <span className="text-success text-xs">&#10003;</span>;
  }
  if (lastResult === "deferred") {
    return (
      <InlineAction
        intent="subtle"
        onClick={() => { if (onToggleError) onToggleError(); }}
        title={lastError ? "Click to expand detail" : undefined}
        className="text-xs text-left"
      >
        &#9203; {errorSummary ? <span className="text-warm-600">{errorSummary.substring(0, 60)}&#8230;</span> : null}
      </InlineAction>
    );
  }
  if (lastResult === "inconclusive") {
    // The work ran; the review reached no verdict. Not a failure, not "never
    // ran" — the reader has to be told there is nothing to conclude.
    return (
      <InlineAction
        intent="subtle"
        onClick={() => { if (onToggleError) onToggleError(); }}
        title={lastError ? "Click to expand detail" : undefined}
        className="text-xs text-left"
      >
        ? {errorSummary ? <span className="text-warm-600">{errorSummary.substring(0, 60)}&#8230;</span> : null}
      </InlineAction>
    );
  }
  if (lastResult === "failure") {
    return (
      <InlineAction
        intent="danger"
        onClick={() => { if (onToggleError) onToggleError(); }}
        title={lastError ? "Click to expand error" : undefined}
        className="text-xs text-left"
      >
        &#10007; {errorSummary ? <span className="text-warm-600">{errorSummary.substring(0, 60)}&#8230;</span> : null}
      </InlineAction>
    );
  }
  return <span className="text-warm-500 text-xs">&mdash;</span>;
}
