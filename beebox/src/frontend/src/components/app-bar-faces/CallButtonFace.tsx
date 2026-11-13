/**
 * The phone button beside the presence heads (docs/plans/chat-calls.md,
 * Track D): start a call when someone else is here and none is going, or
 * join the one going. Nothing otherwise. Pure, so tests render it.
 */

import { Button } from "../ui/Button";

function PhoneIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
    </svg>
  );
}

export function CallButtonFace({ offer, onCall }: { offer: "start" | "join" | null; onCall: () => Promise<void> }) {
  if (offer === null) return null;
  return offer === "start"
    ? <Button id="bbx-call-start" shape="circle" size="sm" intent="success" icon={<PhoneIcon />} label="Start a call" onClick={onCall} />
    : <Button id="bbx-call-join" shape="circle" size="sm" intent="success" icon={<PhoneIcon />} label="Join the call" onClick={onCall} />;
}
