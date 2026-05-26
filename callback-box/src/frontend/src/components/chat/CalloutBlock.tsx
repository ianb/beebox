/**
 * Renders a single `<callout>` block — durable, self-contained content
 * the user must see. `context` renders as a small eyebrow above the body.
 * The body renders as markdown so the agent can use formatting.
 *
 * See `lib/structured-output-parsing.ts` for the data model and
 * `docs/narration-mode-design.md` for the design rationale.
 */

import { useCallback } from "react";
import { Markdown } from "../Markdown";
import type { CalloutData } from "../../lib/structured-output-parsing";
import type { OnZoomView } from "../ChatMessages";
import type { ViewTarget } from "../../lib/view-url";
import { cn } from "../../lib/cn";

export function CalloutBlock({
  callout,
  onZoomView,
  className,
}: {
  callout: CalloutData;
  onZoomView?: OnZoomView;
  className?: string;
}) {
  const handleNavigate = useCallback(
    (target: ViewTarget) => {
      if (onZoomView) onZoomView({ target: { ...target, zoom: false }, label: target.path });
    },
    [onZoomView],
  );
  return (
    <div
      className={cn(
        "my-3 border-l-4 border-accent rounded-r",
        "bg-accent-50 px-4 py-3",
        className,
      )}
    >
      <div className="text-xs uppercase tracking-wide text-accent-dark mb-1">
        {callout.context}
      </div>
      <div className="prose prose-sm max-w-none">
        <Markdown onNavigate={handleNavigate}>{callout.body}</Markdown>
      </div>
    </div>
  );
}

/**
 * Render a group of callouts stacked vertically.
 */
export function CalloutStack({
  callouts,
  onZoomView,
  className,
}: {
  callouts: CalloutData[];
  onZoomView?: OnZoomView;
  className?: string;
}) {
  if (callouts.length === 0) return null;
  return (
    <div className={className}>
      {callouts.map((c, i) => <CalloutBlock key={i} callout={c} onZoomView={onZoomView} />)}
    </div>
  );
}
