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

import { type ReactNode } from "react";
import { MenuItem, MenuDivider } from "./ui/dropdown-menu-item";
import { href } from "../lib/routing";
import { withBase } from "../api";
import { AppBarRecentFilesSlot } from "./app-bar-chrome";
import type { NavMenuEntry } from "../lib/nav-menu-entries";
import type { CardSymbolData } from "@shared/card-symbol";
import { CardMark } from "./ui/CardMark";

/** Panel-swap depth for the switch menu (see `Dropdown`'s `panelIndex`). */
export type SwitchPanel = "root" | "box" | "recent-files";

/** One landmark row's data — the subset of `chat.byLandmark` this menu reads. */
export interface SwitchLandmark {
  /** Box-relative path of the landmark card — the row's identity (see below). */
  path: string;
  /** Box-relative dir; `""` for the root landmark. */
  dir: string;
  label: string;
  symbol: CardSymbolData | null;
  /** Sessions touched inside the fresh window — rendered as a badge when > 0. */
  freshCount: number;
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
      {/* Keyed by card path, not dir: `byLandmark` emits one bucket per
          landmark card, and nothing stops a directory holding two — keying by
          dir would then hand React duplicate keys. */}
      {landmarks.map((landmark) => {
        const current = currentDir !== null && landmark.dir === currentDir;
        return (
          <MenuItem
            key={landmark.path}
            onClick={() => onSelectLandmark(landmark.dir)}
            active={current}
          >
            <span className="flex items-center gap-2 w-full">
              <CardMark symbol={landmark.symbol} size="sm" boxSlug={boxSlug} fallback="📍" />
              <span className={`min-w-0 truncate${current ? " font-semibold" : ""}`}>
                {landmark.label}
              </span>
              {/* "You are here" — the row tint alone was too subtle to read
                  as the current landmark. */}
              {current ? (
                <span className="shrink-0 text-info-dark font-semibold" aria-hidden>
                  ✓
                </span>
              ) : null}
              {current ? <span className="sr-only">(current)</span> : null}
              <FreshCount count={landmark.freshCount} />
            </span>
          </MenuItem>
        );
      })}
    </>
  );
}

/**
 * The "Switch to" section's body: the rows, or — while `chat.placeMenu` is
 * still resolving — a loading line, or, when it failed, a retry row. A failure
 * used to render as "Loading…" forever, which reads as a hang rather than as
 * the recoverable error it is (code-style.md: UI errors stay visible).
 *
 * The copy names the menu, not the landmarks: `placeMenu` reads landmark cards
 * AND enumerates the box's chats, so "couldn't load landmarks" sent readers to
 * inspect landmark cards that were fine. (It said that while a broken Codex
 * CLI was failing the chat half — see `readCodexThreads`, which now degrades
 * rather than failing the query.)
 */
function LandmarkList({
  landmarks,
  failed,
  onRetry,
  boxSlug,
  currentDir,
  onSelectLandmark,
}: {
  landmarks: SwitchLandmark[] | null;
  failed: boolean;
  onRetry: () => void;
  boxSlug: string;
  currentDir: string | null;
  onSelectLandmark: (dir: string) => void;
}) {
  if (landmarks !== null) {
    return (
      <LandmarkRows
        landmarks={landmarks}
        boxSlug={boxSlug}
        currentDir={currentDir}
        onSelectLandmark={onSelectLandmark}
      />
    );
  }
  if (failed) {
    return (
      <MenuItem id="bbx-switch-menu-landmarks-retry" onClick={onRetry} keepOpen danger>
        Couldn&rsquo;t load this menu — Retry
      </MenuItem>
    );
  }
  return <div className="px-3 py-2 text-warm-500">Loading…</div>;
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
          <SectionHeader>Switch to</SectionHeader>
          <LandmarkList
            landmarks={landmarks}
            failed={landmarksFailed}
            onRetry={onRetryLandmarks}
            boxSlug={boxSlug}
            currentDir={currentDir}
            onSelectLandmark={onSelectLandmark}
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
          <MenuItem id="bbx-box-menu-history" to={href(`/${boxSlug}/history`)}>History</MenuItem>
          <MenuItem id="bbx-box-menu-inventory" to={href(`/${boxSlug}/inventory`)}>Storage summary</MenuItem>
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
