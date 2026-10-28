/**
 * The face of a message the box accepted and the agent never got
 * (`docs/implemented-plans/chat-not-delivered.md`): a danger edge around the bubble, the
 * line "Not delivered" inside it, and, on the person's own message, Resend and
 * Discard. The bubble keeps its own colors, so its text keeps its contrast.
 */

import { useState } from "react";
import { errorMessage } from "@shared/error-guards";
import type { SessionEntry } from "../../../api";
import { Button } from "../../ui/Button";
import { MaterialContext } from "../../ui/material";

/** What the bubble's two buttons do; wired by the chat (`undelivered-verbs.ts`). */
export interface UndeliveredVerbs {
  resend: (entry: SessionEntry) => Promise<void>;
  discard: (entry: SessionEntry) => Promise<void>;
}

/** A message the agent never got: a solid danger edge just outside the bubble. */
export const UNDELIVERED_EDGE = "outline outline-2 outline-card-danger outline-offset-2";

/**
 * The box's record of a send keeps no image bytes, so a message that had
 * images cannot be sent again as it was.
 */
function lostImages(entry: SessionEntry): boolean {
  return entry.hadImages === true || entry.content.some((block) => block.type === "image");
}

/** The status line inside the bubble, in the bubble's own ink. */
export function UndeliveredLine({ entry }: { entry: SessionEntry }) {
  return (
    <div className="bbx-chat-user-status text-xs mt-1 font-medium">
      {lostImages(entry) ? "Not delivered — images were not kept" : "Not delivered"}
    </div>
  );
}

/**
 * Resend and Discard, below the bubble. A failure keeps the bubble and says why
 * here, at the place the person acted.
 */
export function UndeliveredActions({ entry, verbs }: { entry: SessionEntry; verbs: UndeliveredVerbs }) {
  const [error, setError] = useState<string | null>(null);
  const attempt = async (verb: (entry: SessionEntry) => Promise<void>): Promise<void> => {
    setError(null);
    try {
      await verb(entry);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  const handleResend = () => attempt(verbs.resend);
  const handleDiscard = () => attempt(verbs.discard);
  return (
    <MaterialContext.Provider value>
      <div className="bbx-chat-pending-material flex flex-col items-end gap-1 mt-1">
        <div className="flex gap-1.5">
          {lostImages(entry) ? null : <Button size="sm" intent="secondary" onClick={handleResend} loadingLabel="sending…">Resend</Button>}
          <Button size="sm" intent="ghost" onClick={handleDiscard} loadingLabel="discarding…">Discard</Button>
        </div>
        {error === null ? null : <div role="alert" className="text-xs text-card-danger pr-2">{error}</div>}
      </div>
    </MaterialContext.Provider>
  );
}
