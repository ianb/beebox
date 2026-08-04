/**
 * The unified app bar (docs/plans/top-nav-ia.md Track C) — one gradient row,
 * every page, every width.
 *
 * There is no link row, box `<select>`, or hamburger any more: navigation
 * lives in the `PlacePill`'s two menus (switch / here), box tools in the
 * pill's Box submenu, and the box's own `nav.card` entries in the switch
 * menu's custom section. What's left beside the pill is attention and meta —
 * the plate badge, the error badge, and the profile menu — plus the chip slot
 * chat pages portal their session/voice chips into (Track C2).
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
import { useBusSubscription, type RealtimeEvent } from "../hooks/useBusSubscription";
import { useDeferredResync } from "../hooks/useDeferredResync";
import { trpc } from "../lib/trpc";
import { useErrorCount, clearErrorCount } from "./DebugLog";
import { Dropdown } from "./ui/Dropdown";
import { MenuItem, MenuDivider } from "./ui/dropdown-menu-item";
import { Avatar } from "./ui/Avatar";
import { href } from "../lib/routing";
import { useBoxes } from "../hooks/useBoxes";
import { withBase } from "../api";
import { isNativeShell } from "./chat/native-post";
import { PlacePill } from "./PlacePill";
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
  const isOnSettings = location.pathname.startsWith(`${base}/settings`);
  const isOnAdmin = location.pathname === `${base}/admin`;

  return (
    <Dropdown
      align="right"
      trigger={({ toggle, ariaProps }) => (
        <button
          type="button"
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
      <MenuItem to={href(`${base}/settings`)} active={isOnSettings}>Settings</MenuItem>
      <MenuItem to={href(`${base}/admin`)} active={isOnAdmin}>Admin</MenuItem>
      <MenuDivider />
      <MenuItem onClick={onToggleSourceView}>Source View</MenuItem>
      <MenuItem onClick={onToggleDebugLog}>Debug Log</MenuItem>
      <MenuItem onClick={() => window.location.reload()}>Reload</MenuItem>
      {user ? <MenuItem href={withBase("/auth/logout")}>Sign out</MenuItem> : null}
    </Dropdown>
  );
}

export function AppNav({ onToggleDebugLog, onToggleSourceView }: { onToggleDebugLog: () => void; onToggleSourceView: () => void }) {
  const { boxSlug } = useParams({ strict: false });
  const location = useRouterState({ select: (s) => s.location });
  const { boxes } = useBoxes();
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
        // Todos live in cards and files. The question events this used to
        // watch moved out with the questions badge.
        if (event.event === "card-created" || event.event === "file-change") {
          triggerNavStatusResync();
        }
      },
      [triggerNavStatusResync],
    ),
  });

  const boxName = boxes.find((b) => b.slug === boxSlug)?.name ?? boxSlug ?? "";
  // A page that knows its own place publishes it (chat: the session's context
  // dir — Track C2); every other route falls back to the route-derived map.
  const publishedPlace = useAppBarPublishedPlace();
  const place = publishedPlace ?? placeLabel({ pathname: location.pathname, boxSlug: boxSlug ?? "" });

  // The native shell owns box picking, so the pill's whole "Box: …" row is
  // suppressed under it (the bar itself is hidden only under `?embed=1`).
  // Read both signals `ChatPage` reads: the chat route's initial
  // `?nativeComposer=1`, plus the injected bridge — which, unlike the param,
  // survives an in-app navigation. Parsing `location.searchStr` rather than
  // calling `useSearch` keeps the bar out of per-route search typing (it sits
  // above every route, and only one route declares the param); it's the same
  // idiom the shell's `?embed=1` check already uses (`app-shell.tsx`).
  const nativeShell =
    new URLSearchParams(location.searchStr).get("nativeComposer") === "1" || isNativeShell();

  return (
    <nav aria-label="Primary" className="bg-gradient-to-r from-info-dark via-primary to-coral text-white flex-shrink-0 shadow-sm print:hidden">
      <div className="flex items-center gap-2 px-3 sm:px-4 py-1.5 text-sm">
        <PlacePill boxSlug={boxSlug ?? ""} boxName={boxName} place={place} hideBoxRow={nativeShell} />
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {/* Chat's session + voice chips portal in here (Track C2). */}
          <AppBarChipSlot />
          <PlateBadge base={base} count={onPlateTodos} />
          <ErrorBadge onToggleDebugLog={onToggleDebugLog} />
          <ProfileMenu user={currentUser} boxSlug={boxSlug || ""} onToggleDebugLog={onToggleDebugLog} onToggleSourceView={onToggleSourceView} />
        </div>
      </div>
    </nav>
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
 * box-wide `todo-view` card ("The Plate", `store/plate.todo-view.card`),
 * per the plan's one app-level todo affordance
 * (`docs/implemented-plans/todo-annotation.md` Track 4). Zero renders nothing.
 */
function PlateBadge({ base, count }: { base: string; count: number }) {
  if (count === 0) return null;
  return (
    <Link
      to={href(`${base}/browse/store/plate.todo-view.card`)}
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
 */
function ErrorBadge({ onToggleDebugLog }: { onToggleDebugLog: () => void }) {
  const errorCount = useErrorCount();
  if (errorCount === 0) return null;
  return (
    <button
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
