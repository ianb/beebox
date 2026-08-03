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
 * Two lazinesses matter. The landmark lookup (`landmarks.forDir`) runs
 * per-place, cheap and scoped to one directory. The switch menu's
 * `chat.byLandmark` — which globs every landmark and enumerates every session
 * — does NOT: it's gated behind the first dropdown open (`enabled`), then
 * cached. A bar that mounts on every page must not carry that at rest (the
 * rationale AppNav already states for `status.navStatus`).
 */

import { useState } from "react";
import { Dropdown } from "./ui/Dropdown";
import { trpc } from "../lib/trpc";
import { apiFileUrl } from "../lib/view-url";
import type { Place } from "../lib/place-label";
import { useOpenLandmarkChat } from "../hooks/useOpenLandmarkChat";
import { useNavMenuEntries } from "../hooks/useNavMenuEntries";
import { SwitchMenuBody, type SwitchPanel } from "./PlacePill-panels";
import { HereMenuBody } from "./PlacePill-here";
import { AppBarHereSlot, useAppBarHereMenuClaimed } from "./app-bar-chrome";

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

/** The resolved landmark's symbol on the pill's face; nothing when unresolved. */
function FaceSymbol({
  symbol,
  symbolSrc,
  boxSlug,
}: {
  symbol: string;
  symbolSrc: string | null;
  boxSlug: string;
}) {
  if (symbolSrc !== null) {
    return (
      <img src={apiFileUrl(boxSlug, symbolSrc)} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
    );
  }
  if (symbol === "") return null;
  return <span className="shrink-0 leading-none" aria-hidden>{symbol}</span>;
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
  hideBoxRow,
}: {
  boxSlug: string;
  boxName: string;
  /**
   * Where the user is. Resolved by AppNav: the place a page published (Track
   * C2) when there is one, else the route-derived fallback (`placeLabel`).
   * The pill doesn't derive it itself — only the bar knows both sources.
   */
  place: Place;
  /**
   * Suppress the entire "Box: … ▸" row. AppNav wires this from the chat
   * route's `nativeComposer` flag (C3) — the native shell owns box picking,
   * so the web Box row would sit on top of a native one.
   */
  hideBoxRow?: boolean;
}) {
  const [switchPanel, setSwitchPanel] = useState<SwitchPanel>("root");
  // First-open latch for the switch menu's data (see the file header). Once
  // true it stays true, so re-opens render from react-query's cache.
  const [switchOpened, setSwitchOpened] = useState(false);
  const openLandmarkChat = useOpenLandmarkChat(boxSlug);
  const hereClaimed = useAppBarHereMenuClaimed();

  const hereQuery = trpc.landmarks.forDir.useQuery(
    { dir: place.dir ?? "" },
    { enabled: place.dir !== null },
  );
  const landmark = place.dir === null ? null : hereQuery.data?.landmark ?? null;

  const switchQuery = trpc.chat.byLandmark.useQuery(undefined, { enabled: switchOpened });
  const switchData = switchQuery.data;
  // The box's own nav.card section — same first-open laziness as the
  // landmark list, and it keeps the card's live-invalidation subscription
  // that the retired link row used to own (Track C3).
  const navEntries = useNavMenuEntries({ base: `/${boxSlug}`, enabled: switchOpened });

  const faceLabel = landmark === null ? place.label : landmark.label;
  const title = place.dir === null ? faceLabel : `${boxName} — ${place.dir === "" ? "/" : `${place.dir}/`}`;

  return (
    <div className="flex items-stretch min-w-0 rounded-full bg-white/10 border border-white/22 text-white text-xs overflow-hidden">
      <Dropdown
        align="left"
        width="w-[20rem]"
        className="min-w-0 flex"
        panelIndex={switchPanel === "root" ? 0 : 1}
        onClose={() => setSwitchPanel("root")}
        trigger={({ toggle, ariaProps }) => (
          // w-full is load-bearing on a Dropdown trigger — measured in-browser
          // on the retired ContextChip: the native <button> doesn't stretch to
          // its wrapper on its own, and without it a long label overflows
          // instead of truncating.
          <button
            type="button"
            onClick={(e) => { setSwitchOpened(true); toggle(e); }}
            className="min-h-[40px] w-full min-w-0 pl-3 pr-2 flex items-center gap-1.5 hover:bg-white/10 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            title={title}
            aria-label={`Place: ${faceLabel}`}
            {...ariaProps}
          >
            <span className="hidden sm:inline shrink-0 opacity-65">{boxName} ▸</span>
            {landmark === null ? null : (
              <FaceSymbol symbol={landmark.symbol} symbolSrc={landmark.symbolSrc} boxSlug={boxSlug} />
            )}
            <span className="min-w-0 truncate">{faceLabel}</span>
            <CaretIcon />
          </button>
        )}
      >
        <SwitchMenuBody
          panel={switchPanel}
          boxSlug={boxSlug}
          boxName={boxName}
          hideBoxRow={hideBoxRow === true}
          currentDir={place.dir}
          landmarks={switchData === undefined ? null : switchData.landmarks}
          navEntries={navEntries}
          problemCount={switchData === undefined ? 0 : switchData.problems.length}
          onOpenBoxPanel={() => setSwitchPanel("box")}
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
            trigger={({ toggle, ariaProps }) => (
              <button
                type="button"
                onClick={toggle}
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
                links={landmark.links}
                groups={landmark.groups}
              />
            )}
          </Dropdown>
        </>
      )}
    </div>
  );
}
