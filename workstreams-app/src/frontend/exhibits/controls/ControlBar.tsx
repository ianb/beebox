// Reply in the session and the comment panel in one strip: what a raw
// index.html exhibit gets when it opts into the control bar (controls.ts).
// Kept apart from the mount so a test can render it without the mount's
// stylesheet import.

import type { ReactNode, RefObject } from "react";

import { CommentPanel } from "../CommentPanel.js";
import { ReplyInSessionButton } from "../Container.js";

/** Reply then Comment in the raw page's top strip. */
export function ControlBar({ scope, contentRef }: {
  scope: string;
  contentRef: RefObject<HTMLElement | null>;
}): ReactNode {
  return (
    <div className="flex min-h-12 max-h-[50dvh] flex-col gap-2 overflow-y-auto border-b border-stone-300 bg-stone-50 px-4 py-1.5 sm:flex-row sm:items-start sm:gap-x-6">
      <ReplyInSessionButton scope={scope} />
      <div className="min-w-0 w-full sm:flex-1">
        <CommentPanel scope={scope} contentRef={contentRef} />
      </div>
    </div>
  );
}
