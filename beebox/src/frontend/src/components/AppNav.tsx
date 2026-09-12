import { workspaceRouteTarget } from "../lib/system-card-navigation";
import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
/**
 * The unified app bar (docs/plans/top-nav-ia.md Track C) — one gradient row,
 * every page, every width.
 *
 * There is no link row, box `<select>`, or hamburger any more: navigation
 * lives in the `PlacePill`'s two menus (switch / here), box tools in the
 * pill's Box submenu, and the box's own `nav.card` entries in the switch
 * menu's custom section. What's left beside the pill is attention and meta —
 * the questions badge, the plate badge, the error badge, and the profile menu
 * — plus the chip slot chat pages portal their session/voice chips into
 * (Track C2).
 *
 * The bar is deliberately ONE responsive element rather than a mobile/desktop
 * pair. Nothing here diverges by width once the link row is gone: the pill
 * handles its own truncation (`sm:` on the box prefix and the dir label) and
 * the badges/avatar are width-agnostic. That is also what lets the chip slot
 * be a single portal target instead of a set (`app-bar-chrome.tsx`).
 *
 * Lives in components/ so the gradient, hover states, and menu styling stay
 * alongside the navigation logic. The app-shell just imports <AppNav>.
 */

import { useCallback } from "react";
import { Link, useParams, useRouterState } from "@tanstack/react-router";
import { useCurrentUser, type CurrentUser } from "../hooks/useCurrentUser";
import { useBoxName } from "../hooks/useBoxName";
import { useBusSubscription, type RealtimeEvent } from "../hooks/useBusSubscription";
import { useDeferredResync } from "../hooks/useDeferredResync";
import { trpc } from "../lib/trpc";
import { useErrorCount, clearErrorCount, hasDebugLogBeenOpened } from "./DebugLog";
import { Dropdown } from "./ui/Dropdown";
import { MenuItem, MenuDivider } from "./ui/dropdown-menu-item";
import { Avatar } from "./ui/Avatar";
import { href } from "../lib/routing";
import { withBase } from "../api";
import { PlacePill } from "./PlacePill";
import { BackToChatChip } from "./BackToChatChip";
import { AppBarChipSlot, useAppBarPublishedPlace } from "./app-bar-chrome";
import { placeLabel } from "../lib/place-label";

/**
 * Profile avatar + dropdown menu — the bar's "meta" corner. Nothing
 * content-shaped lives here: box tools are behind the box's own name, in the
 * pill's Box submenu.
 */
function ProfileMenu({ user, boxSlug, onToggleDebugLog, onToggleSourceView }: { user: CurrentUser | null; boxSlug: string; onToggleDebugLog: () => void; onToggleSourceView: () => void }) {
  const location = useRouterState({ select: (s) => s.location });
  const base = `/${boxSlug}`;
  const isOnSettings = location.pathname.startsWith(`${base}/views/${SYSTEM_CARD_PATHS.settings}`) || workspaceRouteTarget({ pathname: location.pathname, searchStr: location.searchStr, search: location.search })?.path === SYSTEM_CARD_PATHS.settings;
  const isOnAdmin = location.pathname === `${base}/admin`;

  return (
    <Dropdown
      align="right"
      trigger={({ toggle, ariaProps }) => (
        <button
          type="button"
          id="bbx-nav-profile"
          data-bbx-reveal
          data-bbx-does={`opens the profile menu — settings, admin, source view, debug log, reload${user ? ", sign out" : ""}`}
          onClick={toggle}
          className="flex items-center gap-1.5 rounded-full hover:ring-2 hover:ring-white/30 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          title={user ? user.name : "Menu"}
          {...ariaProps}
        >
          <Avatar
            name={user ? user.name : null}
            email={user ? user.email : null}
            picture={user ? user.picture : null}
            fallbackClassName="bg-white/20 text-white"
          />
        </button>
      )}
    >
      {user ? (
        <div className="px-3 py-2 border-b border-warm-100">
          <div className="font-medium text-warm-900 truncate">{user.name}</div>
          <div className="text-xs text-warm-500 truncate">{user.email}</div>
        </div>
      ) : null}
      <MenuItem id="bbx-profile-menu-settings" to={href(`${base}/views/${SYSTEM_CARD_PATHS.settings}`)} active={isOnSettings}>Settings</MenuItem>
      <MenuItem id="bbx-profile-menu-admin" to={href(`${base}/admin`)} active={isOnAdmin}>Admin</MenuItem>
      <MenuDivider />
      <MenuItem id="bbx-profile-menu-source-view" onClick={onToggleSourceView}>Source View</MenuItem>
      <MenuItem id="bbx-profile-menu-debug-log" onClick={onToggleDebugLog}>Debug Log</MenuItem>
      <MenuItem id="bbx-profile-menu-reload" onClick={() => window.location.reload()}>Reload</MenuItem>
      {user ? <MenuItem id="bbx-profile-menu-sign-out" href={withBase("/auth/logout")}>Sign out</MenuItem> : null}
    </Dropdown>
  );
}

export function AppNav({ onToggleDebugLog, onToggleSourceView }: { onToggleDebugLog: () => void; onToggleSourceView: () => void }) {
  const { boxSlug } = useParams({ strict: false });
  const location = useRouterState({ select: (s) => s.location });
  const currentUser = useCurrentUser();

  const base = `/${boxSlug}`;

  // Open on-plate todo count (escalated + on-plate) — the plan's one
  // app-level todo affordance (docs/implemented-plans/todo-annotation.md
  // Track 4), and the only query the bar makes at rest.
  // `status.navStatus`, not `status.status`: the bar renders this one count
  // and nothing else, and it mounts on EVERY page — the fuller dashboard
  // payload (git status/log + a full box card walk) cost ~275 ms per page for
  // fields nothing here reads. Everything the menus need is fetched on their
  // first open (`PlacePill`), never at rest.
  const utils = trpc.useUtils();
  const statusQuery = trpc.status.navStatus.useQuery();
  const onPlateTodos = statusQuery.data ? statusQuery.data.counts.onPlateTodos : 0;
  const pendingQuestions = statusQuery.data ? statusQuery.data.counts.pendingQuestions : 0;

  // A burst of card-created/file-change events (e.g. a bulk upload) would
  // otherwise fire one invalidate per event; coalesce to one per burst, and
  // skip it entirely while the tab is hidden — nothing on screen needs the
  // count refreshed until the bar is looked at again.
  const triggerNavStatusResync = useDeferredResync(
    useCallback(() => { void utils.status.navStatus.invalidate(); }, [utils]),
  );
  useBusSubscription({
    onEvent: useCallback(
      (event: RealtimeEvent) => {
        // Todos live in cards and files; a question card's arrival is a
        // card-created. The question lifecycle events are what the count
        // cannot see from a file write alone — an answered/dismissed/expired
        // question leaves the pending set without a new card appearing.
        if (
          event.event === "card-created" ||
          event.event === "file-change" ||
          event.event === "question-answered" ||
          event.event === "question-dismissed" ||
          event.event === "question-expired"
        ) {
          triggerNavStatusResync();
        }
      },
      [triggerNavStatusResync],
    ),
  });

  const { boxName } = useBoxName();
  // A page that knows its own place publishes it (chat: the session's context
  // dir — Track C2); every other route falls back to the route-derived map.
  const publishedPlace = useAppBarPublishedPlace();
  const place = publishedPlace ?? placeLabel({ pathname: location.pathname, boxSlug: boxSlug ?? "" });

  return (
    <nav aria-label="Primary" className="bbx-app-nav bg-gradient-to-r from-info-dark via-primary to-coral text-white flex-shrink-0 shadow-sm print:hidden">
      <div className="flex items-center gap-2 px-3 sm:px-4 py-1.5 text-sm">
        <PlacePill boxSlug={boxSlug ?? ""} boxName={boxName} place={place} />
        <BackToChatChip boxSlug={boxSlug ?? ""} onChatPage={location.pathname === `${base}/chat`} />
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {/* Chat's session + voice chips portal in here (Track C2). */}
          <AppBarChipSlot />
          <QuestionsBadge base={base} count={pendingQuestions} />
          <PlateBadge base={base} count={onPlateTodos} />
          <ErrorBadge onToggleDebugLog={onToggleDebugLog} />
          <ProfileMenu user={currentUser} boxSlug={boxSlug || ""} onToggleDebugLog={onToggleDebugLog} onToggleSourceView={onToggleSourceView} />
        </div>
      </div>
    </nav>
  );
}

/**
 * Pending questions the box is waiting on an answer for — links to the
 * `/questions` page, which is otherwise unreachable from the bar (the switch
 * menu's Box submenu carries Dashboard/Browse/History/Storage summary, and a
 * box only gets a Questions row by naming it in its own `nav.card`). Zero
 * renders nothing, like {@link PlateBadge}.
 *
 * The bar carried this badge until Track C3 removed it with the link row
 * (`docs/implemented-plans/top-nav-ia.md`), on the way to an "inline
 * questions" replacement that was never specified. What shipped in between
 * was a box whose pending questions appeared only on the dashboard, while
 * `getNavCounts` kept counting them for nobody. Restored here rather than
 * dropping the count; inline questions can still supersede both.
 */
function QuestionsBadge({ base, count }: { base: string; count: number }) {
  if (count === 0) return null;
  return (
    <Link
      id="bbx-nav-questions"
      to={href(`${base}/questions`)}
      className="flex items-center gap-1 text-xs bg-white/20 text-white px-1.5 py-0.5 rounded-full hover:bg-white/30 transition-colors"
      title={`${count} question${count !== 1 ? "s" : ""} waiting for you`}
      aria-label={`${count} question${count !== 1 ? "s" : ""} waiting for you`}
    >
      <QuestionIcon />
      {count}
    </Link>
  );
}

/** A speech bubble carrying a question mark — asked, not yet answered. */
function QuestionIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M2.5 4.25A1.75 1.75 0 0 1 4.25 2.5h7.5a1.75 1.75 0 0 1 1.75 1.75v5a1.75 1.75 0 0 1-1.75 1.75H7l-3 2.5v-2.5h-.25A1.25 1.25 0 0 1 2.5 9.75Z" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M6.4 5.9a1.6 1.6 0 0 1 3.1.55c0 1.05-1.55 1.3-1.55 2.3" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="7.95" cy="10.4" r="0.55" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** The plate's rim, seen from above — the badge's mark instead of a glyph. */
function PlateIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="3.25" strokeWidth="1.25" />
    </svg>
  );
}

/**
 * Open on-plate todo count (escalated + on-plate) — links to the stock
 * box-wide `todo-view` card ("The Plate", `_content/plate.todo-view.card`),
 * per the plan's one app-level todo affordance
 * (`docs/implemented-plans/todo-annotation.md` Track 4). Zero renders nothing.
 */
function PlateBadge({ base, count }: { base: string; count: number }) {
  if (count === 0) return null;
  return (
    <Link
      id="bbx-nav-todo"
      to={href(`${base}/browse/_content/plate.todo-view.card`)}
      className="flex items-center gap-1 text-xs bg-white/20 text-white px-1.5 py-0.5 rounded-full hover:bg-white/30 transition-colors"
      title={`${count} todo${count !== 1 ? "s" : ""} on the plate`}
      aria-label={`${count} todo${count !== 1 ? "s" : ""} on the plate`}
    >
      <PlateIcon />
      {count}
    </Link>
  );
}

/**
 * Small red dot in the nav bar when console errors have occurred.
 *
 * Gated on `hasDebugLogBeenOpened()`: this is a developer affordance, and a
 * first-run screen must never lead with one, so it stays hidden until the
 * person has opened the debug log at least once in this browser (the count
 * still accumulates underneath; the profile menu's "Debug Log" item is the
 * always-reachable path in).
 */
function ErrorBadge({ onToggleDebugLog }: { onToggleDebugLog: () => void }) {
  const errorCount = useErrorCount();
  if (errorCount === 0 || !hasDebugLogBeenOpened()) return null;
  return (
    <button
      id="bbx-nav-errors"
      onClick={() => { clearErrorCount(); onToggleDebugLog(); }}
      className="flex items-center gap-1 text-xs bg-danger/80 text-white px-1.5 py-0.5 rounded-full hover:bg-danger-dark transition-colors"
      title={`${errorCount} error${errorCount !== 1 ? "s" : ""}`}
      aria-label={`Open debug log (${errorCount} error${errorCount !== 1 ? "s" : ""})`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-white" />
      {errorCount}
    </button>
  );
}
