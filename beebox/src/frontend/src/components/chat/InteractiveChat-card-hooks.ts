/**
 * Companion-pane card hook: the open-card attention a send carries. Activity
 * (what the person did to a card) goes through the activity log instead
 * (`lib/activity/`).
 */

import { useCallback } from "react";
import { parseRef } from "@shared/ref-path/core";
import { systemCardAttentionRef } from "../../lib/system-card-navigation";
import type { ChatSendContext } from "@core/chat/card-activity.js";
import type { PanelTab } from "./InteractiveChat-controls";

/** What a SEND event carries from the card layer: `ChatSendContext` (the open card). Omitted when none. */
export type CardSendFields = ChatSendContext;

export interface CardSend {
  /** The open card's attention fields for the send being made. */
  capture: () => CardSendFields;
}

/**
 * The open card (by the focused attention ref, else the active tab) the chat
 * send path stamps onto each turn as `open-card`.
 */
export function useCompanionCard(opts: {
  activeView: PanelTab | null;
  focusedRef?: string;
}): CardSend {
  const source = opts.focusedRef ?? (opts.activeView === null ? undefined : systemCardAttentionRef(opts.activeView.target));
  const capture = useCallback((): CardSendFields => (source === undefined ? {} : { openCard: parseRef(source).path }), [source]);
  return { capture };
}
