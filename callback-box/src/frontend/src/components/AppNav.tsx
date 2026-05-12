/**
 * App-wide navigation bar, profile menu, and error badge.
 *
 * Lives in components/ so the gradient nav, hover states, and mobile
 * menu styling can stay alongside the navigation logic. The app-shell
 * just imports <AppNav>.
 */

import { useState, useEffect, useRef } from "react";
import { Link, useParams, useRouterState } from "@tanstack/react-router";
import { useCurrentUser, type CurrentUser } from "../hooks/useCurrentUser";
import { trpc } from "../lib/trpc";
import { useErrorCount, clearErrorCount } from "./DebugLog";
import { Dropdown, MenuItem, MenuDivider } from "./ui/Dropdown";
import { Avatar } from "./ui/Avatar";
import { href } from "../lib/routing";
import { fetchBoxes } from "../lib/boxes";

/**
 * Profile avatar + dropdown menu (Settings, Admin, Logout).
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
      {user ? <MenuItem href="/auth/logout">Sign out</MenuItem> : null}
    </Dropdown>
  );
}

/**
 * App-wide navigation bar with box switcher and profile menu.
 * On mobile: shows current page name + hamburger menu.
 * On desktop: shows all links inline.
 */
export function AppNav({ onToggleDebugLog, onToggleSourceView }: { onToggleDebugLog: () => void; onToggleSourceView: () => void }) {
  const { boxSlug } = useParams({ strict: false });
  const location = useRouterState({ select: (s) => s.location });
  const [boxes, setBoxes] = useState<Array<{ slug: string; name: string }>>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const currentUser = useCurrentUser();

  useEffect(() => {
    fetchBoxes().then((result) => setBoxes(result.boxes));
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const base = `/${boxSlug}`;

  // The picker query feeds both the Chats page and the freshness badge
  // on the Chats nav entry. React Query dedupes so this isn't a second
  // fetch on the picker page itself.
  const chatPicker = trpc.chat.byLandmark.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const freshCount = chatPicker.data ? chatPicker.data.freshCount : 0;

  const links: Array<{
    to: string;
    label: string;
    match: (p: string) => boolean;
    badge?: number;
  }> = [
    { to: `${base}/`, label: "Dashboard", match: (p: string) => p === base || p === `${base}/` },
    // "Chat" used to mean "go to the most-active session." It still does —
    // renamed to "Recent" so "Chats" (the picker) can sit next to it
    // without two entries fighting over the same word.
    { to: `${base}/chat`, label: "Recent", match: (p: string) => p === `${base}/chat` || p.startsWith(`${base}/chat?`) || p.startsWith(`${base}/chat/`) },
    { to: `${base}/chats`, label: "Chats", match: (p: string) => p.startsWith(`${base}/chats`), badge: freshCount },
    { to: `${base}/questions`, label: "Questions", match: (p: string) => p.startsWith(`${base}/questions`) },
    { to: `${base}/news`, label: "News", match: (p: string) => p.startsWith(`${base}/news`) },
    { to: `${base}/browse`, label: "Browse", match: (p: string) => p.startsWith(`${base}/browse`) },
    { to: `${base}/landmarks`, label: "Landmarks", match: (p: string) => p.startsWith(`${base}/landmarks`) },
    { to: `${base}/activities`, label: "Activities", match: (p: string) => p.startsWith(`${base}/activities`) },
    { to: `${base}/history`, label: "History", match: (p: string) => p.startsWith(`${base}/history`) },
    { to: `${base}/capture`, label: "Capture", match: (p: string) => p.startsWith(`${base}/capture`) },
  ];

  const currentLabel = links.find((l) => l.match(location.pathname))?.label ?? "Dashboard";

  const boxSelector = boxes.length > 1 ? (
    <select
      value={boxSlug}
      onChange={(e) => {
        window.location.href = `/${e.target.value}/`;
      }}
      className="font-bold bg-white/10 text-white border border-white/30 rounded px-2 py-1 text-sm"
    >
      {boxes.map((b) => (
        <option key={b.slug} value={b.slug}>{b.name}</option>
      ))}
    </select>
  ) : (
    <span className="font-bold">{boxSlug}</span>
  );

  return (
    <nav className="bg-gradient-to-r from-info-dark via-primary to-coral text-white flex-shrink-0 shadow-sm print:hidden">
      {/* Mobile: compact bar with hamburger + dropdown */}
      <div className="sm:hidden" ref={menuRef}>
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            {boxSelector}
            <span className="text-white/60">/</span>
            <span className="font-medium">{currentLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1.5 rounded hover:bg-white/10"
              aria-label="Menu"
            >
              {menuOpen ? (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 5h14M3 10h14M3 15h14" />
                </svg>
              )}
            </button>
            <ProfileMenu user={currentUser} boxSlug={boxSlug || ""} onToggleDebugLog={onToggleDebugLog} onToggleSourceView={onToggleSourceView} />
          </div>
        </div>
        {menuOpen ? (
          <div className="border-t border-white/20 px-3 py-2 flex flex-col gap-1">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMenuOpen(false)}
                className={`px-3 py-2 rounded transition-colors ${
                  link.match(location.pathname)
                    ? "bg-white/20 text-white font-medium"
                    : "text-white/70 hover:bg-white/10"
                }`}
              >
                {link.label}
                {link.badge && link.badge > 0 ? <FreshBadge count={link.badge} /> : null}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
      {/* Desktop: inline links + profile */}
      <div className="hidden sm:flex items-center gap-5 px-4 py-2 text-sm">
        {boxSelector}
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className={`hover:text-white transition-colors px-2 py-0.5 rounded ${
              link.match(location.pathname)
                ? "bg-white/20 text-white font-medium"
                : "text-white/70 hover:bg-white/10"
            }`}
          >
            {link.label}
            {link.badge && link.badge > 0 ? <FreshBadge count={link.badge} /> : null}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <ErrorBadge onToggleDebugLog={onToggleDebugLog} />
          <ProfileMenu user={currentUser} boxSlug={boxSlug || ""} onToggleDebugLog={onToggleDebugLog} onToggleSourceView={onToggleSourceView} />
        </div>
      </div>
    </nav>
  );
}

/**
 * Inline count badge next to a nav link — used for the Chats link to
 * show how many fresh chats are sitting in the picker.
 */
function FreshBadge({ count }: { count: number }) {
  return (
    <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-white/20 text-white text-[10px] font-semibold align-middle">
      {count}
    </span>
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
    >
      <span className="w-1.5 h-1.5 rounded-full bg-white" />
      {errorCount}
    </button>
  );
}
