import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
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

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MenuItem, MenuDivider } from "../ui/dropdown-menu-item";
import { Button } from "../ui/Button";
import { href } from "../../lib/routing";
import { withBase } from "../../api";
import { AppBarRecentFilesSlot } from "../app-bar-chrome";
import type { NavMenuEntry } from "../../lib/nav-menu-entries";
import { LandmarkList, type SwitchLandmark } from "./PlacePill-landmarks";

export type { SwitchLandmark } from "./PlacePill-landmarks";

/** Panel-swap depth for the switch menu (see `Dropdown`'s `panelIndex`). */
export type SwitchPanel = "root" | "box" | "recent-files";

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-1 text-xs uppercase tracking-wide text-warm-500">{children}</div>
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
      <MenuItem id="bbx-switch-menu-problems" to={href(`/${boxSlug}/views/${SYSTEM_CARD_PATHS.landmarks}`)} danger>
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
      {/* Keyed by position as well as target: a card may legitimately list the
          same target twice (two labels for one card), and a bare `to` key
          would then collide. */}
      {entries.map((entry, index) => (
        <MenuItem key={`${index}:${entry.to}`} to={href(entry.to)}>{entry.label}</MenuItem>
      ))}
    </>
  );
}

interface SwitchMenuProps {
  panel: SwitchPanel;
  boxSlug: string;
  boxName: string;
  /** The place's dir, for highlighting the landmark the user is already in. */
  currentDir: string | null;
  /** null while the lazy `chat.byLandmark` query is still resolving. */
  landmarks: SwitchLandmark[] | null;
  /** True when that query failed — the list is null for a reason worth saying. */
  landmarksFailed: boolean;
  /** Retry the failed landmark load, from the error row. */
  onRetryLandmarks: () => void;
  /** The box's `nav.card` rows, already deduped against the builtin rows. */
  navEntries: NavMenuEntry[];
  problemCount: number;
  /**
   * Whether the chat page will portal the Recent-files panel in
   * (`useAppBarRecentFilesClaim`). The row only exists on chat pages —
   * recent files are the session's, so there is nothing to list elsewhere.
   */
  recentFilesClaimed: boolean;
  /** False when the native shell owns cross-box navigation through its own box menu. */
  boxSwitchingAvailable: boolean;
  onOpenBoxPanel: () => void;
  onOpenRecentFiles: () => void;
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
    panel, boxSlug, boxName, currentDir, landmarks, landmarksFailed,
    onRetryLandmarks, navEntries, problemCount, recentFilesClaimed,
    boxSwitchingAvailable,
    onOpenBoxPanel, onOpenRecentFiles, onBackToRoot, onSelectLandmark,
  } = props;
  const [searchOpen, setSearchOpen] = useState(false);
  // The dialog's native keydown listener depends on this callback's identity.
  const cancelSearch = useCallback(() => setSearchOpen(false), []);
  const previousSearchOpen = useRef(searchOpen);
  useEffect(() => {
    if (previousSearchOpen.current && !searchOpen) {
      document.getElementById("bbx-switch-menu-landmark-search-toggle")?.focus();
    }
    previousSearchOpen.current = searchOpen;
  }, [searchOpen]);
  switch (panel) {
    case "root":
      return (
        <>
          <MenuItem id="bbx-switch-menu-box" onClick={onOpenBoxPanel} keepOpen>
            <span className="flex justify-between gap-2 w-full">
              <span className="min-w-0 truncate">Box: {boxName}</span>
              <span className="text-warm-500">›</span>
            </span>
          </MenuItem>
          <MenuItem id="bbx-switch-menu-landmarks" to={href(`/${boxSlug}/views/${SYSTEM_CARD_PATHS.landmarks}`)}>All landmarks →</MenuItem>
          {recentFilesClaimed ? (
            <MenuItem id="bbx-switch-menu-recent-files" onClick={onOpenRecentFiles} keepOpen>
              <span className="flex justify-between gap-2 w-full">
                <span>Recent files</span>
                <span className="text-warm-500">›</span>
              </span>
            </MenuItem>
          ) : null}
          <NavCardRows entries={navEntries} />
          <MenuDivider />
          <div className="flex items-center justify-between pr-2"><SectionHeader>Switch to</SectionHeader>
            {landmarks !== null && landmarks.length > 20 ? (
              <Button
                id="bbx-switch-menu-landmark-search-toggle"
                intent="ghost"
                size="sm"
                label="Search landmarks"
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>}
                aria-expanded={searchOpen}
                aria-controls="bbx-switch-menu-landmark-search"
                onClick={() => setSearchOpen(true)}
              />
            ) : null}
          </div>
          <LandmarkList
            landmarks={landmarks}
            failed={landmarksFailed}
            onRetry={onRetryLandmarks}
            boxSlug={boxSlug}
            currentDir={currentDir}
            onSelectLandmark={onSelectLandmark}
            searchOpen={searchOpen}
            onCancelSearch={cancelSearch}
          />
          <ProblemRow count={problemCount} boxSlug={boxSlug} />
        </>
      );
    case "box":
      return (
        <>
          <MenuItem id="bbx-box-menu-back" onClick={onBackToRoot} keepOpen>
            <span className="text-warm-500">‹ Box: {boxName}</span>
          </MenuItem>
          <MenuDivider />
          <MenuItem id="bbx-box-menu-dashboard" to={href(`/${boxSlug}/views/${SYSTEM_CARD_PATHS.dashboard}`)}>Dashboard</MenuItem>
          {/* A bare open resumes Browse; a new tab starts at the box root. */}
          <MenuItem id="bbx-box-menu-browse" to={href(`/${boxSlug}/views/${SYSTEM_CARD_PATHS.browse}`)}>Browse</MenuItem>
          <MenuItem id="bbx-box-menu-history" to={href(`/${boxSlug}/views/${SYSTEM_CARD_PATHS.history}`)}>History</MenuItem>
          <MenuItem id="bbx-box-menu-inventory" to={href(`/${boxSlug}/views/${SYSTEM_CARD_PATHS.inventory}`)}>Storage summary</MenuItem>
          {boxSwitchingAvailable ? (
            <>
              <MenuDivider />
              {/* The front page (box selector) is outside the box's route tree —
                  a plain navigation, not a router Link. */}
              <MenuItem id="bbx-box-menu-other-boxes" href={withBase("/")}>Other boxes →</MenuItem>
            </>
          ) : null}
        </>
      );
    case "recent-files":
      return (
        <>
          <MenuItem id="bbx-recent-files-menu-back" onClick={onBackToRoot} keepOpen>
            <span className="text-warm-500">‹ Recent files</span>
          </MenuItem>
          <MenuDivider />
          {/* The chat portals `RecentFilesMenuBody` in here — the files are
              the session's, so only the chat can list them (Track C2's
              here-slot pattern). The row that opens this panel only renders
              when the chat has claimed it, so the slot is never empty. */}
          <AppBarRecentFilesSlot />
        </>
      );
  }
}
