/**
 * Whether an opener click may send. An opener is sent through the composer's
 * own send funnel, which writes the text into the composer and can then decline
 * silently (a send in flight, a conversation still resolving). Deciding first,
 * with nothing written, lets a click report "rejected" and keep a half-typed
 * draft intact (docs/implemented-plans/landmark-arrival.md, Track A).
 */

export type OpenerSendOutcome = "accepted" | "rejected";

export type OpenerSendDecision =
  | { outcome: "accepted" }
  | { outcome: "rejected"; message: string };

export function openerSendDecision(input: { draft: string; inFlight: boolean; disabledReason: string | undefined }): OpenerSendDecision {
  if (input.draft.trim() !== "") return { outcome: "rejected", message: "Send or clear your draft first." };
  if (input.inFlight) return { outcome: "rejected", message: "Wait for the message that is sending." };
  if (input.disabledReason !== undefined) return { outcome: "rejected", message: input.disabledReason };
  return { outcome: "accepted" };
}
