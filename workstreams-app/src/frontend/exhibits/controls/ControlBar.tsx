// Reply in the session and the comment panel in one strip: what a raw
// index.html exhibit gets when it opts into the control bar (controls.ts).
// Kept apart from the mount so a doctest can render it without the mount's
// stylesheet import.

import type { ReactNode, RefObject } from "react";

import { CommentPanel } from "../CommentPanel.js";
import { ReplyInSessionButton } from "../Container.js";

/** Reply then Comment; the composer opens inside the strip and grows it upward. */
export function ControlBar({ scope, contentRef }: {
  scope: string;
  contentRef: RefObject<HTMLElement | null>;
}): ReactNode {
  return (
    <div className="flex min-h-12 flex-wrap items-start gap-x-6 gap-y-2 border-t border-stone-300 bg-stone-50 px-4 py-1.5">
      <ReplyInSessionButton scope={scope} />
      <div className="min-w-0 flex-1">
        <CommentPanel scope={scope} contentRef={contentRef} />
      </div>
    </div>
  );
}
