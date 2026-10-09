/**
 * Suggested openers on an empty chat.
 *
 * A fresh box's chat used to open on a bare "start a conversation" line: the
 * first move sat entirely on the person at the moment they knew least. These
 * buttons carry the place's openers, and clicking one sends it through the same
 * path as typing it and pressing enter.
 *
 * The list is the box agent's to curate, so rendering nothing is the ordinary
 * case for a box in regular use — the caller keeps its plain empty-state line
 * either way.
 *
 * One accepted click is all there is: the whole set disables as soon as one is
 * sent, so an impatient double-click (or a second opener clicked while the
 * first send is still in flight) can't queue two turns. The list unmounts a
 * moment later anyway, once the first message lands — the state only has to
 * cover that gap. A rejected click (a draft in the composer) leaves the set
 * enabled.
 */

import { useState, type ReactNode } from "react";
import { Button } from "../ui/Button";
import type { OpenerSendOutcome } from "./opener-send";

/**
 * What a click on an opener does, as a plain function so the once-only rule is
 * testable without a DOM (the frontend doctests run under plain Node). Returns
 * whether the send happened. The set is marked sent only after the send
 * accepts, so a rejected click leaves it enabled.
 */
export function clickOpener(
  deps: { alreadySent: boolean; markSent: () => void; onSendOpener: (text: string) => OpenerSendOutcome },
  text: string,
): boolean {
  if (deps.alreadySent) return false;
  if (deps.onSendOpener(text) === "rejected") return false;
  deps.markSent();
  return true;
}

export function ChatOpeners({
  openers,
  onSendOpener,
}: {
  openers: string[];
  /** Send one opener as the person's message; "rejected" leaves the set enabled. */
  onSendOpener: (text: string) => OpenerSendOutcome;
}): ReactNode {
  const [sent, setSent] = useState(false);
  if (openers.length === 0) return null;
  return (
    <div className="flex flex-col items-stretch gap-2 w-full max-w-md" data-testid="chat-openers">
      {openers.map((opener) => (
        <Button
          key={opener}
          intent="secondary"
          size="sm"
          className="text-left"
          disabled={sent}
          onClick={() => {
            clickOpener({ alreadySent: sent, markSent: () => setSent(true), onSendOpener }, opener);
          }}
        >
          {opener}
        </Button>
      ))}
    </div>
  );
}
