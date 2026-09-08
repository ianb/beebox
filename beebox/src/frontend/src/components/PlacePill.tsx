/**
 * The app bar's place chip: a split pill naming where the user is
 * (box ▸ landmark) and opening the two navigation menus
 * (docs/plans/top-nav-ia.md Track C1).
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
 * AppNav already states for `status.navStatus`). The same applies to the
 * `nav.card` section's query.
 *
 * The gate stays; what changed is that the cache is no longer empty when the
 * user reaches for it. ChatPage warms `chat.placeMenu` from idle time once its
 * own bootstrap has settled (`useIdlePrefetch`), so the first open paints rows
 * instead of "Loading…". This query owns none of that — it still just reads
 * whatever cache exists — and a page that doesn't prefetch still opens cold.
 *
 * This menu used to read `chat.byLandmark`, the full picker payload: every chat
 * in the box, bucketed and *named*. It drew none of that but the counts, and
 * naming a chat costs a transcript read — so the one query warmed on every page
 * load was the most expensive in the app. `chat.placeMenu` computes only what
 * is drawn here. If a row ever needs to show a session's name, that's a reason
 * to reconsider this split, not to quietly widen the payload.
 */

import { useEffect, useState } from "react";
import { Dropdown } from "./ui/Dropdown";
import { trpc } from "../lib/trpc";
import type { Place } from "../lib/place-label";
import { useOpenLandmarkChat } from "../hooks/useOpenLandmarkChat";
import { useNavMenuEntries } from "../hooks/useNavMenuEntries";
import { useLazyMenuOpen } from "../hooks/useLazyMenuOpen";
import { SwitchMenuBody, type SwitchLandmark, type SwitchPanel } from "./PlacePill-panels";
import { CardMark } from "./ui/CardMark";
import { HereMenuBody } from "./PlacePill-here";
import { AppBarHereSlot, useAppBarHereMenuClaimed, useAppBarRecentFilesClaimed } from "./app-bar-chrome";
import { isNativeShell } from "./chat/native-post";
import { webBoxSwitchingAvailable } from "../lib/native-shell-navigation";

/** Folder glyph on the here half — the shape the chat's context chip used. */
function FolderIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

/** Menu-opens-here caret, on both halves. */
function CaretIcon() {
  return (
    <svg className="w-3 h-3 shrink-0 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Last segment of a box path; the root reads as "/". */
function dirBasename(dir: string): string {
  if (dir === "") return "/";
  const segments = dir.split("/");
  return segments[segments.length - 1] ?? dir;
}

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
  const [switchPanel, setSwitchPanel] = useState<SwitchPanel>("root");
  const utils = trpc.useUtils();
  const openLandmarkChat = useOpenLandmarkChat(boxSlug);
  const hereClaimed = useAppBarHereMenuClaimed();
  const recentFilesClaimed = useAppBarRecentFilesClaimed();
  const boxSwitchingAvailable = webBoxSwitchingAvailable(isNativeShell());

  // Mount-path: identity only (label, symbol, dir) — no link/expand
  // resolution. Runs on every place, so it stays cheap (see file header).
  const identityQuery = trpc.landmarks.identity.useQuery(
    { dir: place.dir ?? "" },
    { enabled: place.dir !== null },
  );
  const landmark = place.dir === null ? null : identityQuery.data?.identity ?? null;

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

  const switchMenu = useLazyMenuOpen(() => {
    void utils.chat.placeMenu.invalidate();
    void utils.nav.get.invalidate();
  });
  const switchQuery = trpc.chat.placeMenu.useQuery(undefined, { enabled: switchMenu.opened });
  const switchData = switchQuery.data;
  // A failed load is shown in the menu as a retry row, and logged: without
  // both, the menu sat on "Loading…" forever with nothing anywhere saying why.
  const switchError = switchQuery.error;
  useEffect(() => {
    if (switchError !== null) {
      console.error("[app-bar] switch menu: chat.placeMenu failed:", switchError.message);
    }
  }, [switchError]);
  // The box's own nav.card section — same first-open laziness as the
  // landmark list, and it keeps the card's live-invalidation subscription
  // that the retired link row used to own (Track C3).
  const navEntries = useNavMenuEntries({ base: `/${boxSlug}`, enabled: switchMenu.opened });

  // `|| place.label`: an empty landmark label must not blank the face (the
  // backend falls back to the card's filename, but this face must render
  // something even against an older server).
  const faceLabel = landmark === null ? place.label : landmark.label || place.label;

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
  const title = place.dir === null ? faceLabel : `${boxName} — ${place.dir === "" ? "/" : `${place.dir}/`}`;

  return (
    <div className="bbx-place-pill flex items-stretch min-w-0 rounded-full bg-white/10 border border-white/22 text-white text-xs overflow-hidden">
      <Dropdown
        align="left"
        width="w-[20rem]"
        className="min-w-0 flex"
        panelIndex={switchPanel === "root" ? 0 : 1}
        onClose={() => setSwitchPanel("root")}
        trigger={({ open, toggle, ariaProps }) => (
          // w-full is load-bearing on a Dropdown trigger — measured in-browser
          // on the retired ContextChip: the native <button> doesn't stretch to
          // its wrapper on its own, and without it a long label overflows
          // instead of truncating.
          <button
            type="button"
            id="bbx-nav-place"
            onClick={(e) => { if (!open) switchMenu.open(); toggle(e); }}
            className="min-h-[40px] w-full min-w-0 pl-3 pr-2 flex items-center gap-1.5 hover:bg-white/10 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            title={title}
            aria-label={`Where you are: ${faceLabel}`}
            {...ariaProps}
          >
            <span className="hidden sm:inline shrink-0 opacity-65">{boxName} ▸</span>
            {landmark !== null ? (
              <CardMark symbol={landmark.symbol} size="xs" boxSlug={boxSlug} />
            ) : place.dir === "" ? (
              // The box root is a place like any other — with no root landmark
              // card it still gets a symbol, matching its switch-menu row.
              <span className="shrink-0 leading-none" aria-hidden>🏠</span>
            ) : null}
            <span className="min-w-0 truncate">{faceLabel}</span>
            <CaretIcon />
          </button>
        )}
      >
        <SwitchMenuBody
          panel={switchPanel}
          boxSlug={boxSlug}
          boxName={boxName}
          currentDir={place.dir}
          landmarks={switchRows}
          landmarksFailed={switchError !== null}
          onRetryLandmarks={() => { void switchQuery.refetch(); }}
          navEntries={navEntries}
          problemCount={switchData === undefined ? 0 : switchData.problems.length}
          recentFilesClaimed={recentFilesClaimed}
          boxSwitchingAvailable={boxSwitchingAvailable}
          onOpenBoxPanel={() => setSwitchPanel("box")}
          onOpenRecentFiles={() => setSwitchPanel("recent-files")}
          onBackToRoot={() => setSwitchPanel("root")}
          onSelectLandmark={(dir) => { void openLandmarkChat(dir); }}
        />
      </Dropdown>

      {landmark === null ? null : (
        <>
          <span aria-hidden="true" className="w-px my-2 bg-white/22 shrink-0" />
          <Dropdown
            align="left"
            width="w-[20rem]"
            className="shrink-0 flex"
            trigger={({ open, toggle, ariaProps }) => (
              <button
                type="button"
                id="bbx-nav-here"
                data-bbx-does="opens the here menu — open the current folder, plus its landmark's bookmarks"
                onClick={(e) => { if (!open) hereMenu.open(); toggle(e); }}
                className="min-h-[40px] px-2.5 flex items-center gap-1.5 hover:bg-white/10 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                title={`Here: ${landmark.dir === "" ? "/" : `${landmark.dir}/`}`}
                aria-label={`Here: ${dirBasename(landmark.dir)}`}
                {...ariaProps}
              >
                <FolderIcon />
                <span className="hidden sm:inline max-w-[8rem] truncate">{dirBasename(landmark.dir)}</span>
                <CaretIcon />
              </button>
            )}
          >
            {/* Two providers for one menu (plan Track C1/C2). On a chat page
                the body is the chat's own — it needs `messages` and the
                companion-pane zoom the bar can't reach — so we render the
                portal target INSIDE the open Dropdown and the chat fills it.
                Keeping the container here (rather than a permanently-mounted
                hidden one elsewhere) leaves Dropdown's open/close, focus
                restore, and click-outside semantics completely untouched; the
                registration lands in the same commit as the open, so the
                chat's portal fills it before paint. Everywhere else — and
                before the chat mounts — the reduced body below is the menu. */}
            {hereClaimed ? (
              <AppBarHereSlot />
            ) : (
              <HereMenuBody
                dir={landmark.dir}
                boxSlug={boxSlug}
                links={hereLinks}
                groups={hereGroups}
              />
            )}
          </Dropdown>
        </>
      )}
    </div>
  );
}
