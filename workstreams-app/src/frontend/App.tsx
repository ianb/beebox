import { Link, Outlet } from "@tanstack/react-router";

export function AppLayout() {
  return <div className="app-shell"><nav className="app-nav" aria-label="Workstreams"><Link to="/">workstreams</Link><Link to="/issues">issues</Link><Link to="/plans">plans</Link><Link to="/testing">manual testing</Link></nav><Outlet /></div>;
}
