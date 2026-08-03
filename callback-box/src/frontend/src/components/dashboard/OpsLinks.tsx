/**
 * Page-level launcher row for the Dashboard's sibling ops-plane surfaces.
 *
 * The Dashboard is no longer the landing page (docs/plans/top-nav-ia.md) —
 * it is reached from the app bar's Box submenu, and Browse/History sit
 * beside it there. This row repeats that adjacency on the page itself so
 * the ops plane is navigable once you are inside it. RecentActivity's
 * "All history →" stays: it is a section affordance, not a page launcher.
 */

import { Link, useParams } from "@tanstack/react-router";
import { href } from "../../lib/routing";

export function OpsLinks() {
  const { boxSlug } = useParams({ strict: false });
  return (
    <nav aria-label="Box tools" className="flex items-center gap-3">
      <Link
        to={href(`/${boxSlug}/browse`)}
        className="text-sm text-primary hover:text-primary-dark"
      >
        Browse &rarr;
      </Link>
      <Link
        to={href(`/${boxSlug}/history`)}
        className="text-sm text-primary hover:text-primary-dark"
      >
        History &rarr;
      </Link>
    </nav>
  );
}
