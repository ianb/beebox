/**
 * The box-wide pages as profile-menu rows: Dashboard, Browse, History, and
 * Storage summary. They moved here from the box screen, where the boxholder
 * never used them (docs/plans/box-screen.md, "Box-wide pages move to the
 * avatar menu"). The ids are the ones the old box panel used, so smoke
 * snapshots and docs keep one name for each row.
 */

import { useRouterState } from "@tanstack/react-router";
import { workspaceRouteTarget } from "../../lib/system-card-navigation";
import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
import { href } from "../../lib/routing";
import { MenuItem } from "../ui/dropdown-menu-item";

const BOX_PAGES = [
  { id: "bbx-box-menu-dashboard", path: SYSTEM_CARD_PATHS.dashboard, label: "Dashboard" },
  { id: "bbx-box-menu-browse", path: SYSTEM_CARD_PATHS.browse, label: "Browse" },
  { id: "bbx-box-menu-history", path: SYSTEM_CARD_PATHS.history, label: "History" },
  { id: "bbx-box-menu-inventory", path: SYSTEM_CARD_PATHS.inventory, label: "Storage summary" },
] as const;

export function BoxPageMenuItems({ boxSlug }: { boxSlug: string }) {
  const location = useRouterState({ select: (s) => s.location });
  const activePath = workspaceRouteTarget({ pathname: location.pathname, searchStr: location.searchStr, search: location.search })?.path;
  return BOX_PAGES.map((page) => (
    <MenuItem key={page.id} id={page.id} to={href(`/${boxSlug}/views/${page.path}`)} active={activePath === page.path}>{page.label}</MenuItem>
  ));
}
