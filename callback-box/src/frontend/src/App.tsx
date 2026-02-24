/**
 * Main App component for Callback Box frontend.
 */

import { Routes, Route, useNavigate, useParams, useLocation, Link, Outlet, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
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
 */
function AppNav() {
  const location = useLocation();
  const { boxSlug } = useParams();
  const [boxes, setBoxes] = useState<Array<{ slug: string; name: string }>>([]);

  useEffect(() => {
    fetchBoxes().then(setBoxes);
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

  return (
    <nav className="bg-blue-700 text-white px-4 py-2 flex items-center gap-5 text-sm flex-shrink-0 shadow-sm">
      {boxes.length > 1 ? (
        <select
          value={boxSlug}
          onChange={(e) => {
            window.location.href = `/${e.target.value}/`;
          }}
          className="font-bold bg-blue-800 text-white border border-blue-600 rounded px-2 py-0.5 text-sm"
        >
          {boxes.map((b) => (
            <option key={b.slug} value={b.slug}>{b.name}</option>
          ))}
        </select>
      ) : (
        <span className="font-bold mr-2">{boxSlug}</span>
      )}
      {links.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className={`hover:text-white transition-colors px-2 py-0.5 rounded ${
            link.match(location.pathname)
              ? "bg-blue-600 text-white font-medium"
              : "text-blue-200 hover:bg-blue-600"
          }`}
        >
          {link.label}
        </Link>
      ))}
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
    return <div className="p-8 text-gray-500">No card path specified</div>;
  }

  return (
    <div className="h-full bg-gray-50 overflow-auto">
      <div className="max-w-4xl mx-auto py-8 px-4">
        <div className="mb-4">
          <Link to={`/${boxSlug}`} className="text-blue-600 hover:text-blue-800">
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
    return <div className="p-8 text-gray-500">Loading...</div>;
  }

  if (boxes.length === 1) {
    return <Navigate to={`/${boxes[0].slug}/`} replace />;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-md w-full">
        <h1 className="text-2xl font-bold text-gray-800 mb-6 text-center">Callback Box</h1>
        <div className="space-y-3">
          {boxes.map((box) => (
            <Link
              key={box.slug}
              to={`/${box.slug}/`}
              className="block bg-white rounded-lg shadow-sm border border-gray-200 px-6 py-4 hover:border-blue-400 hover:shadow transition-all"
            >
              <span className="text-lg font-medium text-blue-700">{box.name}</span>
              <span className="block text-sm text-gray-500 mt-0.5">/{box.slug}/</span>
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
