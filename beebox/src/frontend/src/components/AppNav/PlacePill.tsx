/**
 * The app bar's place chip: a split pill naming where the user is
 * (box ▸ landmark) and opening the two navigation menus
 * (docs/implemented-plans/top-nav-ia.md Track C1).
 *
 * Face — split like `VoiceChip`'s, but with two separately actionable halves:
 *  - Left (the switch menu): box-name prefix, the landmark's symbol + label
 *    (or the route-derived place label), caret. Its label is the bar's ONE
 *    flexible member — everything else is `shrink-0`, so this is what
 *    truncates as the viewport narrows.
 *  - Right (the here menu): folder icon + the dir's basename, caret. Rendered
 *    only when a landmark actually resolves for the place's directory; with
 *    no landmark there is no curated "here" to open, so the pill is just its
 *    left half.
 *
 * Three lazinesses matter. The FACE's landmark lookup (`landmarks.identity`)
 * runs per-place on mount — cheap, one glob and one cached parse, no link/
 * expand resolution and no pruned-subtree walk (`docs/implemented-plans/card-prominence.md`,
 * "Split identity from resolution"). The switch menu's `chat.placeMenu` —
 * which globs every landmark — and the here menu's `landmarks.forDir` — which
 * resolves this landmark's full link list, including its derived children —
 * do NOT run on mount: each is gated behind its own dropdown's first open
 * (`enabled`), then cached, with every later open invalidating in the
 * background so the cached rows paint instantly and refresh behind them. A
 * bar that mounts on every page must not carry either at rest (the rationale
 * AppNav already states for `status.navStatus`).
 *
 * The gate stays, and the switch menu's cache is warmed in idle time instead
 * (`useIdlePrefetch`), once the face's own identity query has settled: the
 * menu then opens on rows rather than "Loading…", and nothing on the page
 * waits for it. The pill is the warmer because it is the one component that
 * mounts once per box and owns the menu (the warm-up used to live on
 * ChatPage, which the persistent conversation shell replaced). The here menu
 * is not warmed: it is per-place, so a warm-up would run on every navigation.
 *
 * This menu used to read `chat.byLandmark`, the full picker payload: every chat
 * in the box, bucketed and *named*. It drew none of that but the counts, and
 * naming a chat costs a transcript read — so the one query warmed on every page
 * load was the most expensive in the app. `chat.placeMenu` computes only what
 * is drawn here. If a row ever needs to show a session's name, that's a reason
 * to reconsider this split, not to quietly widen the payload.
 */

import { useCallback, useEffect, useRef } from "react";
import { Dropdown } from "../ui/Dropdown";
import { PlacePillFace } from "../app-bar-faces/PlacePillFace";
import { trpc } from "../../lib/trpc/client";
import type { Place } from "../../lib/place-label";
import { useOpenLandmarkChat } from "../../hooks/useOpenLandmarkChat";
import { useLazyMenuOpen } from "../../hooks/useLazyMenuOpen";
import { useIdlePrefetch } from "../../hooks/useIdlePrefetch";
import { useBusSubscription, type RealtimeEvent } from "../../hooks/useBusSubscription";
import { busEventData } from "../../lib/bus-events";
import { landmarkDirOfChange } from "./landmark-change";
import { SwitchMenuBody, type SwitchLandmark } from "./PlacePill-panels";
import { HereMenuBody } from "./PlacePill-here";
import { AppBarHereSlot, useAppBarHereMenuClaimed } from "../app-bar-chrome";

export function PlacePill({
  boxSlug,
  boxName,
  place,
}: {
  boxSlug: string;
  boxName: string;
  /**
   * Where the user is. Resolved by AppNav: the place a page published (Track
   * C2) when there is one, else the route-derived fallback (`placeLabel`).
   * The pill doesn't derive it itself — only the bar knows both sources.
   */
  place: Place;
}) {
  const utils = trpc.useUtils();
  const openLandmarkChat = useOpenLandmarkChat(boxSlug);
  const hereClaimed = useAppBarHereMenuClaimed();

  // Mount-path: identity only (label, symbol, dir) — no link/expand
  // resolution. Runs on every place, so it stays cheap (see file header).
  const identityQuery = trpc.landmarks.identity.useQuery(
    { dir: place.dir ?? "" },
    { enabled: place.dir !== null },
  );
  const landmark = place.dir === null ? null : identityQuery.data?.identity ?? null;

  // A renamed landmark (its `navigation.label`, symbol) must reach the face
  // without a reload. Only the changed directory's identity is invalidated, so
  // the bar pays nothing for edits elsewhere; other cached places refetch on
  // their next visit. Same bus feed that refreshes an open card
  // (`useCardIdentities` does this for the sidecar's tabs).
  const resyncIdentity = useCallback(() => {
    if (place.dir !== null) void utils.landmarks.identity.invalidate({ dir: place.dir });
  }, [place.dir, utils]);
  const connectedOnceRef = useRef(false);
  useBusSubscription({
    onEvent: useCallback((event: RealtimeEvent) => {
      const fileChange = busEventData(event, "file-change");
      if (!fileChange) return;
      const dir = landmarkDirOfChange(fileChange.path);
      if (dir === null) return;
      void utils.landmarks.identity.invalidate({ dir });
    }, [utils]),
    // `file-change` events are transient and never replayed: a rename that
    // landed while the socket was down is picked up when it reconnects.
    onConnect: useCallback(() => {
      if (!connectedOnceRef.current) {
        connectedOnceRef.current = true;
        return;
      }
      resyncIdentity();
    }, [resyncIdentity]),
  });

  // Open-path latches (see file header + `useLazyMenuOpen`'s doc comment):
  // the here menu's full link list (listed + derived + expand) and the
  // switch menu's `chat.placeMenu` each fetch only once their own dropdown
  // is opened, with a background refresh on every later open.
  const hereMenu = useLazyMenuOpen(() => { void utils.landmarks.forDir.invalidate(); });
  const hereQuery = trpc.landmarks.forDir.useQuery(
    { dir: place.dir ?? "" },
    { enabled: hereMenu.opened && place.dir !== null },
  );
  const hereLinks = hereQuery.data?.landmark?.links ?? [];
  const hereGroups = hereQuery.data?.landmark?.groups ?? [];

  const switchMenu = useLazyMenuOpen(() => { void utils.chat.placeMenu.invalidate(); });
  const switchQuery = trpc.chat.placeMenu.useQuery(undefined, { enabled: switchMenu.opened });
  // The disabled query above is already an observer, so the warmed entry is
  // not collected while the bar is mounted. The first open still refetches
  // behind the cached rows, and every later open invalidates.
  useIdlePrefetch(() => utils.chat.placeMenu.prefetch(), {
    enabled: place.dir === null || !identityQuery.isPending,
  });
  const switchData = switchQuery.data;
  // A failed load is shown in the menu as a retry row, and logged: without
  // both, the menu sat on "Loading…" forever with nothing anywhere saying why.
  const switchError = switchQuery.error;
  useEffect(() => {
    if (switchError !== null) {
      console.error("[app-bar] switch menu: chat.placeMenu failed:", switchError.message);
    }
  }, [switchError]);

  // The box root is always a switchable place, landmark card or not. With no
  // root card there is no root row to render, so the menu synthesizes one —
  // otherwise a root chat has no row to be "current" on and the bar reads as a
  // special case (boxholder, 2026-08-05). The server sends `rootFreshCount`
  // precisely for this row, and zero when a real root landmark already covers
  // those chats.
  const switchRows: SwitchLandmark[] | null = (() => {
    if (switchData === undefined) return null;
    if (switchData.landmarks.some((lm) => lm.dir === "")) return switchData.landmarks;
    const root: SwitchLandmark = {
      path: "", dir: "", label: "Box root", symbol: { glyph: "🏠" },
      freshCount: switchData.rootFreshCount,
    };
    return [root, ...switchData.landmarks];
  })();
  return (
    <PlacePillFace
      boxSlug={boxSlug}
      boxName={boxName}
      place={place}
      landmark={landmark}
      onOpen={(half) => { if (half === "switch") switchMenu.open(); else hereMenu.open(); }}
      menu={({ half, className, trigger }) => (
        <Dropdown align="left" width="w-[20rem]" className={className} trigger={trigger}>
          {half === "switch" ? (
            <SwitchMenuBody
              boxSlug={boxSlug}
              boxName={boxName}
              currentDir={place.dir}
              landmarks={switchRows}
              landmarksFailed={switchError !== null}
              onRetryLandmarks={() => { void switchQuery.refetch(); }}
              problemCount={switchData === undefined ? 0 : switchData.problems.length}
              onSelectLandmark={(dir) => { void openLandmarkChat(dir); }}
            />
          ) : hereClaimed ? (
            // Two providers for one menu (plan Track C1/C2). On a chat page
            // the body is the chat's own — it needs `messages` and the
            // companion-pane zoom the bar can't reach — so we render the
            // portal target INSIDE the open Dropdown and the chat fills it.
            // Keeping the container here (rather than a permanently-mounted
            // hidden one elsewhere) leaves Dropdown's open/close, focus
            // restore, and click-outside semantics completely untouched; the
            // registration lands in the same commit as the open, so the
            // chat's portal fills it before paint. Everywhere else — and
            // before the chat mounts — the reduced body below is the menu.
            <AppBarHereSlot />
          ) : landmark === null ? null : (
            <HereMenuBody dir={landmark.dir} boxSlug={boxSlug} links={hereLinks} groups={hereGroups} />
          )}
        </Dropdown>
      )}
    />
  );
}
