/**
 * Companion-pane card hooks: URL persistence of the open card and the
 * per-turn activity accumulator. Split out of `InteractiveChat-hooks.ts` to
 * keep that file under the line budget; both are about the card in the
 * two-pane companion layout (see `docs/plans/companion-pane-card-activity.md`).
 */

import { useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { href, toSearch } from "../../lib/routing";
import { parseViewUrl, serializeViewUrl } from "../../lib/view-url";
import { ACTIVITY_KINDS, type ActivityKind, type CardStateDetails } from "../../../../core/chat/card-activity.js";
import type { PanelTab } from "./InteractiveChat-controls";
import type { OnZoomView } from "../ChatMessages";

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
  const search = useSearch({ strict: false });
  const liveCard = typeof search.card === "string" ? search.card : undefined;

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (initialCard === undefined || initialCard === "") return;
    const target = parseViewUrl(initialCard);
    onZoomView({ target, label: target.path });
  }, [initialCard, onZoomView]);

  const currentCard = activeView ? serializeViewUrl(activeView.target) : undefined;
  useEffect(() => {
    // Don't write before the restore has had its chance — otherwise the first
    // render (activeView still null) would strip a card from the URL before we
    // ever open it. Navigate only on a real change (serialize∘parse is stable,
    // so this can't loop); spread the previous search so other params survive;
    // `replace: true` keeps reload on the same card and doesn't spam history.
    // toSearch() is the sanctioned router-boundary escape hatch (see routing.ts).
    if (!restoredRef.current) return;
    if (liveCard === currentCard) return;
    const next = { ...search };
    if (currentCard === undefined) delete next.card;
    else next.card = currentCard;
    void navigate({ to: href(`/${boxSlug}/chat`), search: toSearch(next), replace: true });
  }, [currentCard, liveCard, search, navigate, boxSlug]);
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
  /** Capture the card fields for a SEND event, clearing the live state. */
  capture: () => CardSendFields;
}

/**
 * Own the per-turn companion-card activity accumulator and the capture/clear
 * lifecycle for the `open-card`/`card-activity`/`card-state` snapshot fields.
 *
 * The accumulator is a per-kind map: `report(kind, detail)` records the kind
 * and overwrites its detail (so per-keystroke reporting collapses to the latest
 * state, no debounce needed). Lifecycle (review #3): `capture` snapshots the
 * kinds + details for a SEND event and optimistically clears the live map (so
 * activity *after* the send accumulates fresh); if that send errors, the effect
 * below re-arms the snapshot so it isn't silently lost.
 */
function useCardSend(opts: {
  activeView: PanelTab | null;
  error: string | null;
}): CardSend {
  const { activeView, error } = opts;
  const kindsRef = useRef<Map<ActivityKind, string | undefined>>(new Map());
  const lastSentRef = useRef<Map<ActivityKind, string | undefined>>(new Map());

  const report = useCallback((kind: ActivityKind, detail?: string) => {
    kindsRef.current.set(kind, detail);
  }, []);

  const capture = useCallback((): CardSendFields => {
    const kinds = ACTIVITY_KINDS.filter((k) => kindsRef.current.has(k));
    const cardState: CardStateDetails = {};
    for (const k of kinds) {
      const detail = kindsRef.current.get(k);
      if (typeof detail === "string" && detail !== "") cardState[k] = detail;
    }
    lastSentRef.current = new Map(kindsRef.current);
    kindsRef.current.clear();
    const openCard = activeView ? activeView.target.path : undefined;
    return {
      ...(openCard !== undefined ? { openCard } : {}),
      ...(kinds.length > 0 ? { cardActivity: kinds } : {}),
      ...(Object.keys(cardState).length > 0 ? { cardState } : {}),
    };
  }, [activeView]);

  // `error` flips null→set only on STREAM_FAILED/STREAM_ERROR; track the edge so
  // a failed send's activity (kinds + details) is re-armed exactly once, without
  // clobbering anything reported since.
  const prevErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (error && !prevErrorRef.current) {
      for (const [k, detail] of lastSentRef.current) {
        if (!kindsRef.current.has(k)) kindsRef.current.set(k, detail);
      }
      lastSentRef.current.clear();
    }
    prevErrorRef.current = error;
  }, [error]);

  return { report, capture };
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
}): CardSend {
  const { initialCard, activeView, onZoomView, boxSlug, error } = opts;
  useCardUrlPersistence({ initialCard, activeView, onZoomView, boxSlug });
  return useCardSend({ activeView, error });
}
