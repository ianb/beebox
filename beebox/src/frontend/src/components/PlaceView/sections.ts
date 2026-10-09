/**
 * What the place page lists, in order: the place's entry points, its primary
 * cards, the places inside it, its pinned links (hand-listed, with no derived
 * level), then each `expand` group. The payload is `landmarks.forDir` with `expandsAsGroups`, so
 * every expand arrives as a labeled group (docs/plans/landmark-arrival.md,
 * Track C).
 */

import type { RouterOutput } from "../../lib/trpc/client";

export type PlacePayload = NonNullable<RouterOutput["landmarks"]["forDir"]["landmark"]>;
type PlaceLink = PlacePayload["links"][number];
type PlaceGroup = PlacePayload["groups"][number];

export type PlaceTier = "entry-point" | "primary" | "places" | "pinned";

export type PlaceSection =
  | { kind: "links"; tier: PlaceTier; links: PlaceLink[] }
  | { kind: "group"; group: PlaceGroup };

export type PlaceSections = { kind: "empty" } | { kind: "sections"; sections: PlaceSection[] };

const TIER_ORDER: PlaceTier[] = ["entry-point", "primary", "places", "pinned"];

function tierOf(link: PlaceLink): PlaceTier {
  switch (link.source) {
    case "derived": return link.prominence === "entry-point" ? "entry-point" : "primary";
    case "place": return "places";
    // A listed card that is also an entry point or primary card shows in that tier.
    case "listed": return link.prominence === "entry-point" || link.prominence === "primary" ? link.prominence : "pinned";
    // With `expandsAsGroups` every non-empty expand is a group; an expand row
    // here would be a server change, so it stays visible with the pinned links.
    case "expand": return "pinned";
  }
}

/** `{ kind: "empty" }` when the place has no links and no groups; else its non-empty tiers, then every group. */
export function placeSections(payload: Pick<PlacePayload, "links" | "groups">): PlaceSections {
  if (payload.links.length === 0 && payload.groups.length === 0) return { kind: "empty" };
  const sections: PlaceSection[] = [];
  for (const tier of TIER_ORDER) {
    const links = payload.links.filter((link) => tierOf(link) === tier);
    if (links.length > 0) sections.push({ kind: "links", tier, links });
  }
  for (const group of payload.groups) sections.push({ kind: "group", group });
  return { kind: "sections", sections };
}
