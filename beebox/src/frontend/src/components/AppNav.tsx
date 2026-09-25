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
 * the attention badges (`app-nav-badges.tsx`) and the profile menu — plus the
 * chip slot chat pages portal their session/voice chips into (Track C2).
 *
 * The bar is deliberately ONE responsive element rather than a mobile/desktop
 * pair. Nothing here diverges by width once the link row is gone: the pill
 * handles its own truncation (`sm:` on the box prefix and the dir label), the
 * chips drop their wordmarks at `sm:`, and the badges/avatar are
 * width-agnostic. That is also what lets the chip slot be a single portal
 * target instead of a set (`app-bar-chrome.tsx`).
 *
 * The right-hand group is `shrink-0` on purpose — its members are icons and
 * counts with nothing left to give — which makes the pill's label the one
 * thing that yields. That is only safe while the group FITS: at 375px with a
 * chat open it once measured 349px of a 351px row and the label reached zero.
 * Anything added here is taken from the label that says where you are, so
 * size it against the phone before adding it.
 *
 * Lives in components/ so the gradient, hover states, and menu styling stay
 * alongside the navigation logic. The app-shell just imports <AppNav>.
 */

import { useCallback } from "react";
import { useParams, useRouterState } from "@tanstack/react-router";
import { useCurrentUser, type CurrentUser } from "../hooks/useCurrentUser";
import { useBoxName } from "../hooks/useBoxName";
import { useBusSubscription, type RealtimeEvent } from "../hooks/useBusSubscription";
import { useDeferredResync } from "../hooks/useDeferredResync";
import { trpc } from "../lib/trpc";
import { Dropdown } from "./ui/Dropdown";
import { MenuItem, MenuDivider } from "./ui/dropdown-menu-item";
import { Avatar } from "./ui/Avatar";
import { href } from "../lib/routing";
import { withBase } from "../api";
import { PlacePill } from "./PlacePill";
import { AttentionBadges } from "./app-nav-badges";
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
  const activePath = workspaceRouteTarget({ pathname: location.pathname, searchStr: location.searchStr, search: location.search })?.path;
  const isOnSettings = activePath === SYSTEM_CARD_PATHS.settings;
  const isOnAdmin = activePath === SYSTEM_CARD_PATHS.admin;
  const isOnPublications = location.pathname === `${base}/publications`;

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
      <MenuItem id="bbx-profile-menu-admin" to={href(`${base}/views/${SYSTEM_CARD_PATHS.admin}`)} active={isOnAdmin}>Admin</MenuItem>
      <MenuItem id="bbx-profile-menu-publications" to={href(`${base}/publications`)} active={isOnPublications}>Publications</MenuItem>
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
  const escalatedTodos = statusQuery.data ? statusQuery.data.counts.escalatedTodos : 0;
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
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {/* Chat's session + voice chips portal in here (Track C2). */}
          <AppBarChipSlot />
          <AttentionBadges base={base} pendingQuestions={pendingQuestions} onPlateTodos={onPlateTodos} escalatedTodos={escalatedTodos} onToggleDebugLog={onToggleDebugLog} />
          <ProfileMenu user={currentUser} boxSlug={boxSlug || ""} onToggleDebugLog={onToggleDebugLog} onToggleSourceView={onToggleSourceView} />
        </div>
      </div>
    </nav>
  );
}
