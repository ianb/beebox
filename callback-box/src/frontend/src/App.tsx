/**
 * Main App component for Callback Box frontend.
 */

import { Routes, Route, useNavigate, useParams, useLocation, Link, Outlet } from "react-router-dom";
import { FileView } from "./components/FileView";
import { NewsPage } from "./components/NewsPage";
import { PrintBriefView } from "./components/brief/PrintBriefView";
import { HistoryPage } from "./components/HistoryPage";
import { SettingsPage } from "./components/SettingsPage";
import { BrowsePage } from "./components/BrowsePage";
import { DashboardPage } from "./components/DashboardPage";

/**
 * App-wide navigation bar.
 */
function AppNav() {
  const location = useLocation();

  const links = [
    { to: "/", label: "Dashboard", match: (p: string) => p === "/" },
    { to: "/news", label: "News", match: (p: string) => p.startsWith("/news") },
    { to: "/browse", label: "Browse", match: (p: string) => p.startsWith("/browse") },
    { to: "/history", label: "History", match: (p: string) => p.startsWith("/history") },
    { to: "/settings", label: "Settings", match: (p: string) => p.startsWith("/settings") },
  ];

  return (
    <nav className="bg-blue-700 text-white px-4 py-2 flex items-center gap-5 text-sm flex-shrink-0 shadow-sm">
      <span className="font-bold mr-2">Callback Box</span>
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
  const { "*": briefPath } = useParams();

  return (
    <NewsPage
      initialPath={briefPath}
      onNavigate={(path) => {
        if (path) {
          navigate(`/news/${path}`);
        } else {
          navigate("/news");
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
  const { "*": browsePath } = useParams();

  return (
    <BrowsePage
      currentPath={browsePath}
      onNavigate={(path) => {
        navigate(path ? `/browse/${path}` : "/browse");
      }}
    />
  );
}

/**
 * Card viewer page wrapper.
 */
function CardViewPage() {
  const { "*": cardPath } = useParams();

  if (!cardPath) {
    return <div className="p-8 text-gray-500">No card path specified</div>;
  }

  return (
    <div className="h-full bg-gray-50 overflow-auto">
      <div className="max-w-4xl mx-auto py-8 px-4">
        <div className="mb-4">
          <Link to="/" className="text-blue-600 hover:text-blue-800">
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
 * Main App with routing.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/print/*" element={<PrintBriefView />} />
      <Route element={<AppLayout />}>
        <Route path="/news/*" element={<NewsPageWrapper />} />
        <Route path="/browse/*" element={<BrowsePageWrapper />} />
        <Route path="/history/:hash?" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/card/*" element={<CardViewPage />} />
        <Route path="*" element={<DashboardPage />} />
      </Route>
    </Routes>
  );
}
