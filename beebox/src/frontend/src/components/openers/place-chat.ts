/**
 * Whether the place page offers the place's openers ("Start something"), and
 * whether it offers a link to the place's own chat instead.
 *
 * The page is a card; it can sit beside a chat in this place, beside a chat
 * bound to another place, or outside any chat. A click on an opener sends it as
 * the person's message into the chat beside the page, so the page offers them
 * only where that chat is this place's chat (docs/plans/landmark-arrival.md,
 * Track C, boxholder decisions a and b):
 *
 * - outside a chat there is nowhere to send, so nothing is offered;
 * - beside an unstarted chat in this place the chat already shows the same
 *   openers, so the page does not repeat them;
 * - beside a chat in another place, an opener would start this place's work in
 *   the other place's conversation, so the page offers a link to this place's
 *   chat instead.
 */

import { createContext } from "react";
import type { OpenerSendOutcome } from "./opener-send";

/** The chat a place page is shown beside, provided by the chat around its workspace. */
export interface PlaceChat {
  /** The chat's bound place: a logical landmark dir (`""` for the root), or null when it has none. */
  contextDir: string | null;
  /** The chat is showing its own openers now (unstarted, nothing sent yet). */
  showsOwnOpeners: boolean;
  /** Send an opener as the person's message; "rejected" leaves the draft and the buttons as they were. */
  sendOpener: (text: string) => OpenerSendOutcome;
}

/** Null outside a chat (a card opened on its own page). */
export const PlaceChatContext = createContext<PlaceChat | null>(null);

export interface StartSomething {
  /** The openers to show as "Start something"; empty hides the group. */
  openers: string[];
  /** Offer a link to this place's chat: the page sits beside another place's chat. */
  goToPlace: boolean;
}

/** `payloadDir` is the place's logical dir, the same form as the chat's `contextDir`. */
export function startSomething(input: { payloadDir: string; openers: string[]; chat: PlaceChat | null }): StartSomething {
  const { payloadDir, openers, chat } = input;
  if (chat === null) return { openers: [], goToPlace: false };
  if (chat.contextDir !== payloadDir) return { openers: [], goToPlace: true };
  if (chat.showsOwnOpeners) return { openers: [], goToPlace: false };
  return { openers, goToPlace: false };
}
