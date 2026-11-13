/**
 * Companion-pane card hooks: URL persistence of the open card and the
 * per-turn activity accumulator. Split out of `InteractiveChat-hooks.ts` to
 * keep that file under the line budget; both are about the card in the
 * two-pane companion layout (see `docs/implemented-plans/companion-pane-card-activity.md`).
 */

import { useRef, useCallback } from "react";
import { systemCardAttentionRef } from "../../lib/system-card-navigation";
import type { ViewTarget } from "../../lib/view-url";
import { CardActivityStore } from "./conversation/card-activity-store";
import type { ActivityKind, ChatSendContext, ReportActivity } from "@core/chat/card-activity.js";
import type { PanelTab } from "./InteractiveChat-controls";

/** What `useCardSend` carries on a SEND event: `ChatSendContext` (open card +
 *  activity since the last reply + per-kind detail). All omitted when empty. */
export type CardSendFields = ChatSendContext;

/** Report activity on the card whose activity source is `source`. */
export type CardActivityReport = (source: string, activity: { kind: ActivityKind; detail?: string }) => void;

/**
 * A card's activity source key: the same key the focused card's attention
 * ref uses, so what a card reports is what a send from it captures.
 */
export function cardActivitySource(target: ViewTarget): string {
  return systemCardAttentionRef(target);
}

/**
 * A reporter bound to the card at `target`. Every mounted companion card gets
 * its own, so a background card (the other pane, a figure still running)
 * reports under its own name and never under the focused card's.
 */
export function bindCardActivity(report: CardActivityReport, target: ViewTarget): ReportActivity {
  const source = cardActivitySource(target);
  // The third argument (`activity`) is for the log, which the view's own
  // wrapper (AgentViewRenderer) writes; this bound reporter is the snapshot.
  return (kind, detail) => { report(source, { kind, ...(detail === undefined ? {} : { detail }) }); };
}

export interface CardSend {
  /** Report activity on the card at `source` with an optional free-text detail
   *  (e.g. the query typed). The detail overwrites any prior detail for the
   *  same kind — typing `b`,`bo`,`boat` collapses to the final state. */
  report: CardActivityReport;
  /** Capture without discarding activity; rejection/cancellation leaves it intact. */
  capture: () => CardSendFields;
  /** Consume only the accepted snapshot, preserving later activity per source. */
  accepted: (fields: CardSendFields) => void;
}

/** Activity follows its content source, independently of the selected conversation. */
function useCardSend(source: string | undefined): CardSend {
  const store = useRef(new CardActivityStore()).current;
  const report = useCallback<CardActivityReport>((at, activity) => { store.report(at, activity); }, [store]);
  const capture = useCallback(() => store.capture(source), [source, store]);
  const accepted = useCallback((fields: CardSendFields) => { store.accepted(fields); }, [store]);
  return { report, capture, accepted };
}

/**
 * Umbrella for the companion-pane card concerns: persist the open card in the
 * URL (restore on reload, sync on change) and own the per-turn activity
 * accumulator. Returns the {@link CardSend} the chat send path uses to stamp
 * `open-card`/`card-activity` onto each turn.
 */
export function useCompanionCard(opts: {
  activeView: PanelTab | null;
  focusedRef?: string;
}): CardSend {
  return useCardSend(opts.focusedRef ?? (opts.activeView === null ? undefined : cardActivitySource(opts.activeView.target)));
}
