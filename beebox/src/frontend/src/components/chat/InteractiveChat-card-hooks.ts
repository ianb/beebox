/**
 * Companion-pane card hooks: URL persistence of the open card and the
 * per-turn activity accumulator. Split out of `InteractiveChat-hooks.ts` to
 * keep that file under the line budget; both are about the card in the
 * two-pane companion layout (see `docs/plans/companion-pane-card-activity.md`).
 */

import { useRef, useCallback } from "react";
import { serializeViewUrl } from "../../lib/view-url";
import { CardActivityStore } from "./conversation/card-activity-store";
import type { ActivityKind, CardStateDetails } from "@core/chat/card-activity.js";
import type { PanelTab } from "./InteractiveChat-controls";

/** What `useCardSend` carries on a SEND event: open card + activity since the
 *  last reply + per-kind detail. All omitted when empty. */
export interface CardSendFields {
  openCard?: string;
  cardActivity?: ActivityKind[];
  cardState?: CardStateDetails;
}

export interface CardSend {
  /** Report activity on the open card with an optional free-text detail (e.g.
   *  the query typed). The detail overwrites any prior detail for the same kind
   *  — typing `b`,`bo`,`boat` collapses to the final state. */
  report: (kind: ActivityKind, detail?: string) => void;
  /** Capture without discarding activity; rejection/cancellation leaves it intact. */
  capture: () => CardSendFields;
  /** Consume only the accepted snapshot, preserving later activity per source. */
  accepted: (fields: CardSendFields) => void;
}

/** Activity follows its content source, independently of the selected conversation. */
function useCardSend(source: string | undefined): CardSend {
  const store = useRef(new CardActivityStore()).current;
  const report = useCallback((kind: ActivityKind, detail?: string) => {
    store.report(source, { kind, ...(detail === undefined ? {} : { detail }) });
  }, [source, store]);
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
  return useCardSend(opts.focusedRef ?? (opts.activeView === null ? undefined : serializeViewUrl(opts.activeView.target)));
}
