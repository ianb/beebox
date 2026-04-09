/**
 * App shell components: layout, navigation, redirects, and wrapper pages.
 *
 * Extracted from the old App.tsx. These are used by the route tree in router.tsx.
 */

import { useState, useEffect, useRef } from "react";
import { Link, Outlet, useParams, useNavigate, useRouterState } from "@tanstack/react-router";
import { FileView } from "./components/FileView";
import { NewsPage } from "./components/NewsPage";
import { BrowsePage } from "./components/BrowsePage";
import { useCurrentUser, type CurrentUser } from "./hooks/useCurrentUser";
import { enableDebugLogCapture, DebugLogPanel, useErrorCount, clearErrorCount } from "./components/DebugLog";
import { SourceViewOverlay, useSourceView } from "./components/SourceViewOverlay";

import { href } from "./lib/routing";

// Start capturing console errors immediately so we never miss early failures
enableDebugLogCapture();

interface BoxesResult {
  boxes: Array<{ slug: string; name: string }>;
  authRequired?: boolean;
}

/**
 * Fetch the list of available boxes from the server.
 */
async function fetchBoxes(): Promise<BoxesResult> {
  try {
    const resp = await fetch("/api/boxes");
    if (!resp.ok) return { boxes: [] };
    const data = await resp.json();
    return { boxes: data.boxes ?? [], authRequired: data.authRequired };
  } catch (_e) {
    return { boxes: [] };
  }
}

/**
 * Profile avatar + dropdown menu (Settings, Admin, Logout).
 */
function ProfileMenu({ user, boxSlug, onToggleDebugLog, onToggleSourceView }: { user: CurrentUser | null; boxSlug: string; onToggleDebugLog: () => void; onToggleSourceView: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useRouterState({ select: (s) => s.location });
  const base = `/${boxSlug}`;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const initial = user ? (user.name || user.email)[0]!.toUpperCase() : null;
  const isOnSettings = location.pathname.startsWith(`${base}/settings`);
  const isOnAdmin = location.pathname === `${base}/admin`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-full hover:ring-2 hover:ring-white/30 transition-all"
        title={user ? user.name : "Menu"}
      >
        {user && user.picture ? (
          <img
            src={user.picture}
            alt=""
            className="w-7 h-7 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : initial ? (
          <span className="w-7 h-7 rounded-full bg-white/20 text-white text-xs font-bold flex items-center justify-center">
            {initial}
          </span>
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/80">
            <circle cx="10" cy="10" r="7" />
            <path d="M10 8.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM10 9.5c-2.5 0-4 1.5-4 3v.5h8v-.5c0-1.5-1.5-3-4-3z" fill="currentColor" stroke="none" />
          </svg>
        )}
      </button>

      {open ? (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-warm-200 py-1 z-50 text-sm">
          {user ? (
            <div className="px-3 py-2 border-b border-warm-100">
              <div className="font-medium text-warm-900 truncate">{user.name}</div>
              <div className="text-xs text-warm-500 truncate">{user.email}</div>
            </div>
          ) : null}

          <Link
            to={href(`${base}/settings`)}
            onClick={() => setOpen(false)}
            className={`block px-3 py-2 transition-colors ${
              isOnSettings
                ? "bg-warm-100 text-warm-900 font-medium"
                : "text-warm-700 hover:bg-warm-50"
            }`}
          >
            Settings
          </Link>

          <Link
            to={href(`${base}/admin`)}
            onClick={() => setOpen(false)}
            className={`block px-3 py-2 transition-colors ${
              isOnAdmin
                ? "bg-warm-100 text-warm-900 font-medium"
                : "text-warm-700 hover:bg-warm-50"
            }`}
          >
            Admin
          </Link>

          <div className="border-t border-warm-100 mt-1 pt-1">
            <button
              onClick={() => { setOpen(false); onToggleSourceView(); }}
              className="block w-full text-left px-3 py-2 text-warm-700 hover:bg-warm-50 transition-colors"
            >
              Source View
            </button>
            <button
              onClick={() => { setOpen(false); onToggleDebugLog(); }}
              className="block w-full text-left px-3 py-2 text-warm-700 hover:bg-warm-50 transition-colors"
            >
              Debug Log
            </button>
            <button
              onClick={() => { setOpen(false); window.location.reload(); }}
              className="block w-full text-left px-3 py-2 text-warm-700 hover:bg-warm-50 transition-colors"
            >
              Reload
            </button>
            {user ? (
              <a
                href="/auth/logout"
                className="block px-3 py-2 text-warm-700 hover:bg-warm-50 transition-colors"
              >
                Sign out
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * App-wide navigation bar with box switcher and profile menu.
 * On mobile: shows current page name + hamburger menu.
 * On desktop: shows all links inline.
 */
function AppNav({ onToggleDebugLog, onToggleSourceView }: { onToggleDebugLog: () => void; onToggleSourceView: () => void }) {
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

  const links = [
    { to: `${base}/`, label: "Dashboard", match: (p: string) => p === base || p === `${base}/` },
    { to: `${base}/chat`, label: "Chat", match: (p: string) => p.startsWith(`${base}/chat`) },
    { to: `${base}/questions`, label: "Questions", match: (p: string) => p.startsWith(`${base}/questions`) },
    { to: `${base}/news`, label: "News", match: (p: string) => p.startsWith(`${base}/news`) },
    { to: `${base}/browse`, label: "Browse", match: (p: string) => p.startsWith(`${base}/browse`) },
    { to: `${base}/todos`, label: "Todos", match: (p: string) => p.startsWith(`${base}/todos`) },
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
    <nav className="bg-gradient-to-r from-iris-dark via-plum to-coral text-white flex-shrink-0 shadow-sm">
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
 * Small red dot in the nav bar when console errors have occurred.
 */
function ErrorBadge({ onToggleDebugLog }: { onToggleDebugLog: () => void }) {
  const errorCount = useErrorCount();
  if (errorCount === 0) return null;
  return (
    <button
      onClick={() => { clearErrorCount(); onToggleDebugLog(); }}
      className="flex items-center gap-1 text-xs bg-red-500/80 text-white px-1.5 py-0.5 rounded-full hover:bg-red-600 transition-colors"
      title={`${errorCount} error${errorCount !== 1 ? "s" : ""}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-white" />
      {errorCount}
    </button>
  );
}

/**
 * Layout wrapper with navigation.
 */
export function AppLayout() {
  const [showDebugLog, setShowDebugLog] = useState(false);
  const sourceView = useSourceView();

  const handleToggleSourceView = sourceView.toggle;
  const handleCloseSourceView = sourceView.toggle;

  return (
    <div className="h-screen h-[100dvh] flex flex-col">
      <AppNav
        onToggleDebugLog={() => { clearErrorCount(); setShowDebugLog((v) => !v); }}
        onToggleSourceView={handleToggleSourceView}
      />
      <div className="flex-1 min-h-0 overflow-x-hidden">
        <Outlet />
      </div>
      {showDebugLog ? <DebugLogPanel onClose={() => setShowDebugLog(false)} /> : null}
      <SourceViewOverlay active={sourceView.active} onClose={handleCloseSourceView} />
    </div>
  );
}

/**
 * News page wrapper with route parameters.
 */
export function NewsPageWrapper() {
  const navigate = useNavigate();
  const { boxSlug, _splat: briefPath } = useParams({ strict: false });

  return (
    <NewsPage
      initialPath={briefPath}
      onNavigate={(path) => {
        if (path) {
          navigate({ to: href(`/${boxSlug}/news/${path}`) });
        } else {
          navigate({ to: href(`/${boxSlug}/news`) });
        }
      }}
    />
  );
}

/**
 * Browse page wrapper with route parameters.
 */
export function BrowsePageWrapper() {
  const navigate = useNavigate();
  const { boxSlug, _splat: browsePath } = useParams({ strict: false });

  return (
    <BrowsePage
      currentPath={browsePath}
      onNavigate={(path) => {
        navigate({ to: href(path ? `/${boxSlug}/browse/${path}` : `/${boxSlug}/browse`) });
      }}
    />
  );
}

/**
 * Card viewer page wrapper.
 */
export function CardViewPage() {
  const { boxSlug, _splat: cardPath } = useParams({ strict: false });

  if (!cardPath) {
    return <div className="p-8 text-warm-600">No card path specified</div>;
  }

  return (
    <div className="h-full bg-warm-50 overflow-auto">
      <div className="max-w-4xl mx-auto py-8 px-4">
        <div className="mb-4">
          <Link to={href(`/${boxSlug}`)} className="text-plum hover:text-plum-dark">
            &larr; Back to Dashboard
          </Link>
        </div>
        <div className="bg-white rounded-lg shadow">
          <FileView path={cardPath} />
        </div>
      </div>
    </div>
  );
}

/**
 * Root page: if one box, redirect; if multiple, show links.
 */
export function BoxRedirect() {
  const navigate = useNavigate();
  const [boxes, setBoxes] = useState<Array<{ slug: string; name: string }>>([]);
  const [authRequired, setAuthRequired] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBoxes().then((result) => {
      setBoxes(result.boxes);
      setAuthRequired(result.authRequired ?? false);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!loading && boxes.length === 1) {
      navigate({ to: "/$boxSlug", params: { boxSlug: boxes[0]!.slug }, replace: true });
    }
  }, [loading, boxes, navigate]);

  if (loading) {
    return <div className="p-8 text-warm-600">Loading...</div>;
  }

  if (boxes.length === 0 && authRequired) {
    return (
      <div className="min-h-screen bg-warm-50 flex items-center justify-center">
        <div className="max-w-sm w-full text-center">
          <h1 className="text-2xl font-bold text-warm-800 mb-4">Callback Box</h1>
          <p className="text-warm-600 mb-6">Sign in to access your boxes.</p>
          <a
            href={`/auth/login?returnTo=${encodeURIComponent(window.location.pathname)}`}
            className="inline-block bg-plum text-white px-6 py-3 rounded-lg font-medium hover:bg-plum-dark transition-colors"
          >
            Sign in with Google
          </a>
        </div>
      </div>
    );
  }

  if (boxes.length === 1) {
    return <div className="p-8 text-warm-600">Redirecting...</div>;
  }

  return (
    <div className="min-h-screen bg-warm-50 flex items-center justify-center">
      <div className="max-w-md w-full">
        <h1 className="text-2xl font-bold text-warm-800 mb-6 text-center">Callback Box</h1>
        <div className="space-y-3">
          {boxes.map((box) => (
            <Link
              key={box.slug}
              to={href(`/${box.slug}/`)}
              className="block bg-white rounded-lg shadow-sm border border-warm-300 px-6 py-4 hover:border-gold hover:shadow transition-all"
            >
              <span className="text-lg font-medium text-plum">{box.name}</span>
              <span className="block text-sm text-warm-600 mt-0.5">/{box.slug}/</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Redirect /share?params to /:boxSlug/share?params.
 * Picks the first available box (or shows selector if multiple).
 */
export function ShareRedirect() {
  const navigate = useNavigate();
  const [boxes, setBoxes] = useState<Array<{ slug: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBoxes().then((result) => {
      setBoxes(result.boxes);
      setLoading(false);
    });
  }, []);

  // Preserve query params when redirecting
  const search = window.location.search;

  useEffect(() => {
    if (!loading && boxes.length === 1) {
      navigate({ to: href(`/${boxes[0]!.slug}/share${search}`), replace: true });
    }
  }, [loading, boxes, navigate, search]);

  if (loading) {
    return <div className="min-h-screen bg-warm-50 flex items-center justify-center"><span className="text-warm-600">Loading...</span></div>;
  }

  if (boxes.length === 1) {
    return <div className="min-h-screen bg-warm-50 flex items-center justify-center"><span className="text-warm-600">Redirecting...</span></div>;
  }

  if (boxes.length > 1) {
    return (
      <div className="min-h-screen bg-warm-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <h1 className="text-xl font-bold text-warm-800 mb-4 text-center">Save to which box?</h1>
          <div className="space-y-3">
            {boxes.map((box) => (
              <a
                key={box.slug}
                href={`/${box.slug}/share${search}`}
                className="block bg-white rounded-lg shadow-sm border border-warm-300 px-6 py-4 hover:border-gold hover:shadow transition-all"
              >
                <span className="text-lg font-medium text-plum">{box.name}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return <div className="p-8 text-warm-600">No boxes available.</div>;
}
