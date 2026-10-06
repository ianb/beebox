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

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MenuItem, MenuDivider } from "../ui/dropdown-menu-item";
import { TextField } from "../ui/fields/field";
import { Button } from "../ui/Button";
import { href } from "../../lib/routing";
import { withBase } from "../../api";
import type { CardSymbolData } from "@shared/card-symbol";
import { CardMark } from "../ui/CardMark";

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
  searchOpen,
}: {
  landmarks: SwitchLandmark[];
  boxSlug: string;
  currentDir: string | null;
  onSelectLandmark: (dir: string) => void;
  searchOpen: boolean;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const searchable = landmarks.length > 20;
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleLandmarks = !searchable || normalizedQuery === ""
    ? landmarks
    : landmarks.filter((landmark) => `${landmark.label}\n${landmark.dir}`.toLocaleLowerCase().includes(normalizedQuery));

  return (
    <>
      {searchable && searchOpen ? (
        <div className="px-3 py-2" role="none">
          <TextField
            id="bbx-switch-menu-landmark-search"
            label="Search landmarks"
            inputRef={searchRef}
            hideLabel
            type="search"
            placeholder="Search landmarks"
            value={query}
            onChange={setQuery}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                const firstLandmark = event.currentTarget.closest('[role="menu"]')?.querySelector<HTMLElement>("#bbx-switch-menu-landmark-first");
                if (firstLandmark) {
                  firstLandmark.focus();
                } else if (visibleLandmarks[0] !== undefined) {
                  onSelectLandmark(visibleLandmarks[0].dir);
                }
              }
              if (event.key === "Enter" && visibleLandmarks.length > 0) {
                event.preventDefault();
                const firstRow = event.currentTarget.closest('[role="menu"]')?.querySelector<HTMLButtonElement>("#bbx-switch-menu-landmark-first");
                if (firstRow) {
                  firstRow.click();
                } else {
                  const firstLandmark = visibleLandmarks[0];
                  if (firstLandmark !== undefined) onSelectLandmark(firstLandmark.dir);
                }
              }
              if (event.key === "Escape" && query !== "") {
                event.stopPropagation();
                event.preventDefault();
                setQuery("");
              }
            }}
          />
        </div>
      ) : null}
      {/* Keyed by card path, not dir: `byLandmark` emits one bucket per
          landmark card, and nothing stops a directory holding two — keying by
          dir would then hand React duplicate keys. */}
      {visibleLandmarks.map((landmark) => {
        const current = currentDir !== null && landmark.dir === currentDir;
        return (
          <MenuItem
            key={landmark.path}
            id={landmark === visibleLandmarks[0] ? "bbx-switch-menu-landmark-first" : undefined}
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
      {searchable && normalizedQuery !== "" && visibleLandmarks.length === 0 ? (
        <MenuItem disabled onClick={() => {}}>No landmarks match</MenuItem>
      ) : null}
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
  searchOpen,
}: {
  landmarks: SwitchLandmark[] | null;
  failed: boolean;
  onRetry: () => void;
  boxSlug: string;
  currentDir: string | null;
  onSelectLandmark: (dir: string) => void;
  searchOpen: boolean;
}) {
  if (landmarks !== null) {
    return (
      <LandmarkRows
        landmarks={landmarks}
        boxSlug={boxSlug}
        currentDir={currentDir}
        onSelectLandmark={onSelectLandmark}
        searchOpen={searchOpen}
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
      />
      <ProblemRow count={problemCount} boxSlug={boxSlug} />
    </>
  );
}
