/**
 * The `PlacePill`'s switch menu — the app bar's activity switcher
 * (docs/plans/top-nav-ia.md Track C1). Split out of PlacePill.tsx to keep
 * both files under the line cap, mirroring `VoiceChip-panels.tsx`.
 *
 * Layout follows the boxholder's stable-above-variable rule: the fixed rows
 * ("Box: <name> ▸", "All landmarks →") come first, then a divider and a
 * "Switch to" header, then the landmark list, which varies per box. The
 * unassigned bucket is deliberately NOT rendered here — the menu lists
 * landmarks only; landmark-less chats live on the Landmarks page.
 */

import { type ReactNode } from "react";
import { MenuItem, MenuDivider } from "./ui/dropdown-menu-item";
import { href } from "../lib/routing";
import { apiFileUrl } from "../lib/view-url";
import { withBase } from "../api";
import type { NavMenuEntry } from "../lib/nav-menu-entries";

/** Panel-swap depth for the switch menu (see `Dropdown`'s `panelIndex`). */
export type SwitchPanel = "root" | "box";

/** One landmark row's data — the subset of `chat.byLandmark` this menu reads. */
export interface SwitchLandmark {
  /** Box-relative dir; `""` for the root landmark. */
  dir: string;
  label: string;
  symbol: string;
  symbolSrc: string | null;
  /** Sessions touched inside the fresh window — rendered as a badge when > 0. */
  freshCount: number;
}

/** Landmark symbol: an image when the card names one, else its text glyph. */
function LandmarkSymbol({ landmark, boxSlug }: { landmark: SwitchLandmark; boxSlug: string }) {
  if (landmark.symbolSrc !== null) {
    return (
      <img
        src={apiFileUrl(boxSlug, landmark.symbolSrc)}
        alt=""
        className="w-5 h-5 rounded-full object-cover shrink-0"
      />
    );
  }
  return (
    <span className="text-base leading-none shrink-0 w-5 text-center" aria-hidden>
      {landmark.symbol || "📍"}
    </span>
  );
}

/** Count of fresh chats in a landmark's bucket. Absent when zero. */
function FreshCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-auto shrink-0 text-xs text-warm-500 tabular-nums">{count}</span>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-1 text-xs uppercase tracking-wide text-warm-500">{children}</div>
  );
}

function LandmarkRows({
  landmarks,
  boxSlug,
  currentDir,
  onSelectLandmark,
}: {
  landmarks: SwitchLandmark[];
  boxSlug: string;
  currentDir: string | null;
  onSelectLandmark: (dir: string) => void;
}) {
  return (
    <>
      {landmarks.map((landmark) => (
        <MenuItem
          key={landmark.dir}
          onClick={() => onSelectLandmark(landmark.dir)}
          active={currentDir !== null && landmark.dir === currentDir}
        >
          <span className="flex items-center gap-2 w-full">
            <LandmarkSymbol landmark={landmark} boxSlug={boxSlug} />
            <span className="min-w-0 truncate">{landmark.label}</span>
            <FreshCount count={landmark.freshCount} />
          </span>
        </MenuItem>
      ))}
    </>
  );
}

/**
 * Parse failures, surfaced rather than swallowed: a hand-edited landmark card
 * that no longer parses would otherwise just vanish from the only activity
 * switcher. The Landmarks page shows which cards (Track D).
 */
function ProblemRow({ count, boxSlug }: { count: number; boxSlug: string }) {
  if (count === 0) return null;
  return (
    <>
      <MenuDivider />
      <MenuItem to={href(`/${boxSlug}/landmarks`)} danger>
        ⚠ {count} landmark card{count === 1 ? "" : "s"} didn&rsquo;t parse
      </MenuItem>
    </>
  );
}

/**
 * The box's own `nav.card` entries (Track C3) — the section that used to be
 * the bar's link row. Entries duplicating a builtin row are already filtered
 * out upstream (`lib/nav-menu-entries.ts`); an empty list renders nothing at
 * all, divider included, so a box without a card sees no trace of it.
 */
function NavCardRows({ entries }: { entries: NavMenuEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <>
      <MenuDivider />
      {entries.map((entry) => (
        <MenuItem key={entry.to} to={href(entry.to)}>{entry.label}</MenuItem>
      ))}
    </>
  );
}

interface SwitchMenuProps {
  panel: SwitchPanel;
  boxSlug: string;
  boxName: string;
  /** Suppress the whole "Box: …" row (the native shell owns box picking). */
  hideBoxRow: boolean;
  /** The place's dir, for highlighting the landmark the user is already in. */
  currentDir: string | null;
  /** null while the lazy `chat.byLandmark` query is still resolving. */
  landmarks: SwitchLandmark[] | null;
  /** The box's `nav.card` rows, already deduped against the builtin rows. */
  navEntries: NavMenuEntry[];
  problemCount: number;
  onOpenBoxPanel: () => void;
  onBackToRoot: () => void;
  onSelectLandmark: (dir: string) => void;
}

/**
 * Exhaustive panel dispatch — a `switch` with no `default:` (the frontend
 * `.tsx` rule bans `default:` cases outright; TypeScript's
 * switch-exhaustiveness check still catches an unhandled new `SwitchPanel`
 * member at compile time without one).
 */
export function SwitchMenuBody(props: SwitchMenuProps): ReactNode {
  const {
    panel, boxSlug, boxName, hideBoxRow, currentDir, landmarks, navEntries, problemCount,
    onOpenBoxPanel, onBackToRoot, onSelectLandmark,
  } = props;
  switch (panel) {
    case "root":
      return (
        <>
          {hideBoxRow ? null : (
            <MenuItem onClick={onOpenBoxPanel} keepOpen>
              <span className="flex justify-between gap-2 w-full">
                <span className="min-w-0 truncate">Box: {boxName}</span>
                <span className="text-warm-500">›</span>
              </span>
            </MenuItem>
          )}
          <MenuItem to={href(`/${boxSlug}/landmarks`)}>All landmarks →</MenuItem>
          <NavCardRows entries={navEntries} />
          <MenuDivider />
          <SectionHeader>Switch to</SectionHeader>
          {landmarks === null ? (
            <div className="px-3 py-2 text-warm-500">Loading…</div>
          ) : (
            <LandmarkRows
              landmarks={landmarks}
              boxSlug={boxSlug}
              currentDir={currentDir}
              onSelectLandmark={onSelectLandmark}
            />
          )}
          <ProblemRow count={problemCount} boxSlug={boxSlug} />
        </>
      );
    case "box":
      return (
        <>
          <MenuItem onClick={onBackToRoot} keepOpen>
            <span className="text-warm-500">‹ Box: {boxName}</span>
          </MenuItem>
          <MenuDivider />
          <MenuItem to={href(`/${boxSlug}/dashboard`)}>Overview</MenuItem>
          <MenuItem to={href(`/${boxSlug}/browse`)}>Browse</MenuItem>
          <MenuItem to={href(`/${boxSlug}/history`)}>History</MenuItem>
          <MenuDivider />
          {/* The front page (box selector) is outside the box's route tree —
              a plain navigation, not a router Link. */}
          <MenuItem href={withBase("/")}>Other boxes →</MenuItem>
        </>
      );
  }
}
