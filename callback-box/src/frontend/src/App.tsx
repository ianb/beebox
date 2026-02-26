/**
 * Main App component for Callback Box frontend.
 */

import { Routes, Route, useNavigate, useParams, useLocation, Link, Outlet, Navigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { FileView } from "./components/FileView";
import { NewsPage } from "./components/NewsPage";
import { PrintBriefView } from "./components/brief/PrintBriefView";
import { HistoryPage } from "./components/HistoryPage";
import { SettingsPage } from "./components/SettingsPage";
import { BrowsePage } from "./components/BrowsePage";
import { DashboardPage } from "./components/DashboardPage";
import { ChatPage } from "./components/ChatPage";

/**
 * Fetch the list of available boxes from the server.
 */
async function fetchBoxes(): Promise<Array<{ slug: string; name: string }>> {
  try {
    const resp = await fetch("/api/boxes");
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.boxes ?? [];
  } catch {
    return [];
  }
}

/**
 * App-wide navigation bar with box switcher.
 * On mobile: shows current page name + hamburger menu.
 * On desktop: shows all links inline.
 */
function AppNav() {
  const location = useLocation();
  const { boxSlug } = useParams();
  const [boxes, setBoxes] = useState<Array<{ slug: string; name: string }>>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchBoxes().then(setBoxes);
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
    { to: `${base}/news`, label: "News", match: (p: string) => p.startsWith(`${base}/news`) },
    { to: `${base}/browse`, label: "Browse", match: (p: string) => p.startsWith(`${base}/browse`) },
    { to: `${base}/history`, label: "History", match: (p: string) => p.startsWith(`${base}/history`) },
    { to: `${base}/settings`, label: "Settings", match: (p: string) => p.startsWith(`${base}/settings`) },
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
      {/* Mobile: compact bar with hamburger */}
      <div className="sm:hidden flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          {boxSelector}
          <span className="text-white/60">/</span>
          <span className="font-medium">{currentLabel}</span>
        </div>
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
      </div>
      {/* Mobile dropdown */}
      {menuOpen ? (
        <div ref={menuRef} className="sm:hidden border-t border-white/20 px-3 py-2 flex flex-col gap-1">
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
      {/* Desktop: inline links */}
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
      </div>
    </nav>
  );
}

/**
 * Layout wrapper with navigation.
 */
function AppLayout() {
  return (
    <div className="h-screen flex flex-col">
      <AppNav />
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
    </div>
  );
}

/**
 * News page wrapper with route parameters.
 */
function NewsPageWrapper() {
  const navigate = useNavigate();
  const { boxSlug, "*": briefPath } = useParams();

  return (
    <NewsPage
      initialPath={briefPath}
      onNavigate={(path) => {
        if (path) {
          navigate(`/${boxSlug}/news/${path}`);
        } else {
          navigate(`/${boxSlug}/news`);
        }
      }}
    />
  );
}

/**
 * Browse page wrapper with route parameters.
 */
function BrowsePageWrapper() {
  const navigate = useNavigate();
  const { boxSlug, "*": browsePath } = useParams();

  return (
    <BrowsePage
      currentPath={browsePath}
      onNavigate={(path) => {
        navigate(path ? `/${boxSlug}/browse/${path}` : `/${boxSlug}/browse`);
      }}
    />
  );
}

/**
 * Card viewer page wrapper.
 */
function CardViewPage() {
  const { boxSlug, "*": cardPath } = useParams();

  if (!cardPath) {
    return <div className="p-8 text-warm-600">No card path specified</div>;
  }

  return (
    <div className="h-full bg-warm-50 overflow-auto">
      <div className="max-w-4xl mx-auto py-8 px-4">
        <div className="mb-4">
          <Link to={`/${boxSlug}`} className="text-plum hover:text-plum-dark">
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
function BoxRedirect() {
  const [boxes, setBoxes] = useState<Array<{ slug: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBoxes().then((b) => {
      setBoxes(b);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <div className="p-8 text-warm-600">Loading...</div>;
  }

  if (boxes.length === 1) {
    return <Navigate to={`/${boxes[0].slug}/`} replace />;
  }

  return (
    <div className="min-h-screen bg-warm-50 flex items-center justify-center">
      <div className="max-w-md w-full">
        <h1 className="text-2xl font-bold text-warm-800 mb-6 text-center">Callback Box</h1>
        <div className="space-y-3">
          {boxes.map((box) => (
            <Link
              key={box.slug}
              to={`/${box.slug}/`}
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
 * Main App with routing.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<BoxRedirect />} />
      <Route path="/:boxSlug/print/*" element={<PrintBriefView />} />
      <Route path="/:boxSlug" element={<AppLayout />}>
        <Route path="news/*" element={<NewsPageWrapper />} />
        <Route path="browse/*" element={<BrowsePageWrapper />} />
        <Route path="history/:hash?" element={<HistoryPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="card/*" element={<CardViewPage />} />
        <Route index element={<DashboardPage />} />
        <Route path="*" element={<DashboardPage />} />
      </Route>
    </Routes>
  );
}
