/**
 * The place pill's face, apart from its menus and queries so the theme
 * studio renders the same face with fixed props (see `AppNav/PlacePill.tsx`).
 */

import type { ReactNode } from "react";
import type { DropdownTriggerProps } from "../ui/Dropdown";
import type { LandmarkIdentity } from "@backend/trpc/routers/landmarks/router.js";
import { dirBasename, type Place } from "../../lib/place-label";
import { CardMark } from "../ui/CardMark";

/** Folder glyph on the here half — the shape the chat's context chip used. */
function FolderIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

/**
 * Menu-opens-here caret, on both halves.
 *
 * Hidden below `sm:`: at phone width it is 12px per chip spent saying "this
 * opens a menu", which the pill and chips already say by being tappable and by
 * their `aria-haspopup` — and 12px is a word of the place label
 * (boxholder, 2026-09-20). It stays from `sm:` up, where the bar can afford it.
 */
export function CaretIcon() {
  return (
    <svg className="hidden sm:block w-3 h-3 shrink-0 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** What the face shows of a landmark. */
export type PlacePillLandmark = Pick<LandmarkIdentity, "dir" | "label" | "symbol">;

/**
 * Where one half's menu opens. The face supplies the trigger and the wrapper's
 * layout classes; the live pill wraps them in a `Dropdown` with its menu body,
 * the theme studio with a fixed one.
 */
export type PlacePillMenu = (half: {
  half: "switch" | "here";
  className: string;
  trigger: (props: DropdownTriggerProps) => ReactNode;
}) => ReactNode;

/**
 * The pill as drawn: container, the switch half and (with a landmark) the
 * here half. Presentational, so the theme studio renders this same face with
 * fixed props.
 */
export function PlacePillFace({ boxSlug, boxName, place, landmark, menu, onOpen }: {
  boxSlug: string;
  boxName: string;
  place: Place;
  landmark: PlacePillLandmark | null;
  menu: PlacePillMenu;
  /** Called when a half's menu is about to open. */
  onOpen?: (half: "switch" | "here") => void;
}) {
  // `|| place.label`: an empty landmark label must not blank the face (the
  // backend falls back to the card's filename, but this face must render
  // something even against an older server).
  const faceLabel = landmark === null ? place.label : landmark.label || place.label;
  const title = place.dir === null ? faceLabel : `${boxName} — ${place.dir === "" ? "/" : `${place.dir}/`}`;
  return (
    <div className="bbx-place-pill flex items-stretch min-w-0 rounded-full bg-white/10 border border-white/22 text-white text-xs overflow-hidden">
      {menu({
        half: "switch",
        className: "min-w-0 flex overflow-hidden",
        trigger: ({ open, toggle, ariaProps }) => (
          // w-full is load-bearing on a Dropdown trigger — measured in-browser
          // on the retired ContextChip: the native <button> doesn't stretch to
          // its wrapper on its own, and without it a long label overflows
          // instead of truncating.
          // overflow-hidden (here and on the wrapper): when the bar is too
          // crowded for any label, the half clips its mark instead of drawing
          // it under the here half beside it; so the focus ring is inset.
          <button
            type="button"
            id="bbx-nav-place"
            onClick={(e) => { if (!open) onOpen?.("switch"); toggle(e); }}
            className="min-h-[40px] w-full min-w-0 overflow-hidden pl-2 pr-1 sm:pl-3 sm:pr-2 flex items-center gap-1.5 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40"
            title={title}
            aria-label={`Where you are: ${faceLabel}`}
            {...ariaProps}
          >
            {/* The prefix anchors a nested place ("Box ▸ Lending"). At the root
                the face label already names the box (by default it is the box
                name itself), so printing both reads as a path. */}
            {place.dir === "" ? null : <span className="hidden sm:inline shrink-0">{boxName} ▸</span>}
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
        ),
      })}

      {landmark === null ? null : (
        <>
          <span aria-hidden="true" className="w-px my-2 bg-white/22 shrink-0" />
          {menu({
            half: "here",
            className: "shrink-0 flex",
            trigger: ({ open, toggle, ariaProps }) => (
              <button
                type="button"
                id="bbx-nav-here"
                data-bbx-does="opens the here menu — open the current folder, plus its landmark's bookmarks"
                onClick={(e) => { if (!open) onOpen?.("here"); toggle(e); }}
                className="min-h-[40px] px-2.5 flex items-center gap-1.5 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                title={`Here: ${landmark.dir === "" ? "/" : `${landmark.dir}/`}`}
                aria-label={`Here: ${dirBasename(landmark.dir)}`}
                {...ariaProps}
              >
                <FolderIcon />
                <span className="hidden sm:inline max-w-[8rem] truncate">{dirBasename(landmark.dir)}</span>
                <CaretIcon />
              </button>
            ),
          })}
        </>
      )}
    </div>
  );
}
