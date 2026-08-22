import { Link, Outlet, useSearch } from "@tanstack/react-router";

import { QuickOpen } from "./components/QuickOpen.js";

/**
 * Quick-open lives in the shell so Cmd-P works from every page, and it inherits
 * whatever workstream lens the current page is under — searching the branch you
 * are reading, not always main.
 */
function QuickOpenMount() {
  const search: { workstream?: string } = useSearch({ strict: false });
  return <QuickOpen workstream={search.workstream ?? null} />;
}

export function AppLayout() {
  return <div className="app-shell"><nav className="app-nav" aria-label="Workstreams"><Link to="/">recent</Link><Link to="/streams">workstreams</Link><Link to="/issues">issues</Link><Link to="/plans">plans</Link><Link to="/testing">manual testing</Link><Link to="/asks">asks</Link></nav><Outlet /><QuickOpenMount /></div>;
}
