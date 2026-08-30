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
import { Card } from "../ui/Card";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { TextLink } from "../ui/TextLink";

export function OpsLinks() {
  const { boxSlug } = useParams({ strict: false });
  return (
    <Stack gap="sm">
      <nav aria-label="Box tools" className="flex items-center gap-3">
        <Link
          id="bbx-dashboard-browse"
          to={href(`/${boxSlug}/browse`)}
          className="text-sm text-primary hover:text-primary-dark"
        >
          Browse &rarr;
        </Link>
        <Link
          id="bbx-dashboard-history"
          to={href(`/${boxSlug}/history`)}
          className="text-sm text-primary hover:text-primary-dark"
        >
          History &rarr;
        </Link>
      </nav>
      <Card background="info" padding="sm" as="section" aria-label="Inventory summary">
        <TextLink id="bbx-dashboard-inventory" to={href(`/${boxSlug}/inventory`)} underline={false}>Open inventory summary &rarr;</TextLink>
        <Text as="p" size="sm" tone="muted" className="mt-1">See repository size, Git and annex storage, file types, and linked versus unlinked content.</Text>
      </Card>
    </Stack>
  );
}
