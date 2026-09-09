/**
 * Companion-pane card hooks: URL persistence of the open card and the
 * per-turn activity accumulator. Split out of `InteractiveChat-hooks.ts` to
 * keep that file under the line budget; both are about the card in the
 * two-pane companion layout (see `docs/plans/companion-pane-card-activity.md`).
 */

import { useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearch, useLocation } from "@tanstack/react-router";
import { href, toSearch } from "../../lib/routing";
import { parseViewUrl, serializeViewUrl } from "../../lib/view-url";
import { CardActivityStore } from "./conversation/card-activity-store";
import type { ActivityKind, CardStateDetails } from "@core/chat/card-activity.js";
import type { PanelTab } from "./InteractiveChat-controls";
import type { OnZoomView } from "./ChatMessages";

/**
 * Persist the live companion-pane card in the URL (`?card=`) so a reload
 * restores it, and keep the param in sync as the active card changes.
 *
 * Two effects, both guarded against the TanStack search-param sync loop
 * (spread-previous, navigate only on a real change, `replace: true`):
 *
 *  - **Restore once on mount.** `initialCard` is a serialized view URL (no
 *    `view:` prefix); parse it and open the tab. A ref guards re-runs so a
 *    re-render — or the user closing the tab — can't reopen it. Distinct from
 *    `useCompanionDeepLink`, which is the one-shot `?companion=` deep-link.
 *  - **Sync active card → URL.** Serialize `activeView.target` to the canonical
 *    form and write it through a spread-previous search updater that returns
 *    the previous object untouched when nothing changed, so it never clobbers
 *    `session`/`contextDir` and never loops (serialize∘parse is stable).
 */
function useCardUrlPersistence(opts: {
  initialCard: string | undefined;
  activeView: PanelTab | null;
  onZoomView: OnZoomView;
  boxSlug: string | undefined;
}) {
  const { initialCard, activeView, onZoomView, boxSlug } = opts;
  const navigate = useNavigate();
  const onChatPage = useLocation().pathname.endsWith("/chat");
  const search = useSearch({ strict: false });
  const liveCard = typeof search.card === "string" ? search.card : undefined;

  const observedInput = useRef<string | undefined>(undefined);
  const projectedCard = useRef<string | undefined>(undefined);
  const restorePending = useRef<string | null>(null);
  useEffect(() => {
    if (!onChatPage || initialCard === observedInput.current) return;
    observedInput.current = initialCard;
    if (!initialCard || initialCard === projectedCard.current) return;
    restorePending.current = initialCard;
    const target = parseViewUrl(initialCard);
    onZoomView({ target, label: target.path });
  }, [initialCard, onZoomView, onChatPage]);

  const currentCard = activeView ? serializeViewUrl(activeView.target) : undefined;
  useEffect(() => {
    // Don't write before the restore has had its chance — otherwise the first
    // render (activeView still null) would strip a card from the URL before we
    // ever open it. Navigate only on a real change (serialize∘parse is stable,
    // so this can't loop); `replace: true` keeps reload on the same card and
    // doesn't spam history. toSearch() is the sanctioned router-boundary escape
    // hatch (see routing.ts).
    //
    // A FUNCTIONAL updater, not a spread of the captured `search`: the
    // companion deep-link hook strips `?companion=` in the same commit, and a
    // write built from a snapshot taken before that put the param back — so a
    // reload re-fired the one-shot deep link and reopened a card that had been
    // closed, which is the exact bug useCompanionDeepLink's own comment warns
    // about.
    if (!onChatPage) return;
    if (restorePending.current !== null && restorePending.current !== currentCard) return;
    restorePending.current = null;
    if (liveCard === currentCard) return;
    projectedCard.current = currentCard;
    void navigate({
      to: href(`/${boxSlug}/chat`),
      search: toSearch((prev: Record<string, unknown>) => {
        const next = { ...prev };
        if (currentCard === undefined) delete next["card"];
        else next["card"] = currentCard;
        return next;
      }),
      replace: true,
    });
  }, [currentCard, liveCard, navigate, boxSlug, onChatPage]);
}

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
  initialCard: string | undefined;
  activeView: PanelTab | null;
  onZoomView: OnZoomView;
  boxSlug: string | undefined;
  error: string | null;
  focusedRef?: string;
}): CardSend {
  const { initialCard, activeView, onZoomView, boxSlug, focusedRef } = opts;
  useCardUrlPersistence({ initialCard, activeView, onZoomView, boxSlug });
  return useCardSend(focusedRef ?? (activeView === null ? undefined : serializeViewUrl(activeView.target)));
}
