import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
/**
 * The `PlacePill`'s landmark menu — the app bar's activity switcher
 * (docs/plans/top-nav-ia.md Track C1, reshaped by docs/plans/box-screen.md
 * track 3). Split out of PlacePill.tsx to keep both files under the line cap,
 * mirroring `VoiceChip-panels.tsx`.
 *
 * Layout follows the boxholder's stable-above-variable rule: the fixed rows
 * ("Box: <name>", which opens the box screen, and "Find a landmark") come
 * first, then a divider and a "Switch to" header, then the landmark list,
 * which varies per box. The unassigned bucket is deliberately NOT rendered
 * here — the menu lists landmarks only; landmark-less chats live on the
 * Landmarks page.
 */


import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MenuItem, MenuDivider } from "../ui/dropdown-menu-item";
import { Button } from "../ui/Button";
import { href } from "../../lib/routing";
import { withBase } from "../../api";
import { LandmarkList, type SwitchLandmark } from "./PlacePill-landmarks";

export type { SwitchLandmark } from "./PlacePill-landmarks";

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

interface SwitchMenuProps {
  boxSlug: string;
  boxName: string;
  /** The place's dir, for highlighting the landmark the user is already in. */
  currentDir: string | null;
  /** null while the lazy `chat.placeMenu` query is still resolving. */
  landmarks: SwitchLandmark[] | null;
  /** True when that query failed — the list is null for a reason worth saying. */
  landmarksFailed: boolean;
  /** Retry the failed landmark load, from the error row. */
  onRetryLandmarks: () => void;
  problemCount: number;
  onSelectLandmark: (dir: string) => void;
}

/**
 * The box row is a plain document navigation to the box screen, not a router
 * link: in a browser it loads the web box screen, and the native shell
 * intercepts it to show its own (docs/plans/box-screen.md, track 4).
 */
export function SwitchMenuBody(props: SwitchMenuProps): ReactNode {
  const {
    boxSlug, boxName, currentDir, landmarks, landmarksFailed,
    onRetryLandmarks, problemCount, onSelectLandmark,
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
  return (
    <>
      <MenuItem id="bbx-switch-menu-box" href={withBase(`/${boxSlug}/box`)}>
        <span className="block min-w-0 truncate">Box: {boxName}</span>
      </MenuItem>
      <MenuItem id="bbx-switch-menu-landmarks" to={href(`/${boxSlug}/views/${SYSTEM_CARD_PATHS.landmarks}`)}>Find a landmark</MenuItem>
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
}
