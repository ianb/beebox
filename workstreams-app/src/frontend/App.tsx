import { Link, Outlet } from "@tanstack/react-router";

export function AppLayout() {
  return <div className="app-shell"><nav className="app-nav" aria-label="Workstreams"><Link to="/">recent</Link><Link to="/streams">workstreams</Link><Link to="/issues">issues</Link><Link to="/plans">plans</Link><Link to="/testing">manual testing</Link><Link to="/asks">asks</Link></nav><Outlet /></div>;
}
