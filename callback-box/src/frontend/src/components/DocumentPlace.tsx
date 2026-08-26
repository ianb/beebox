/**
 * The landmark for the directory you're in, published to the tab title.
 *
 * The title reads `<mark> <page> — <box>`, and this supplies the mark: the
 * emoji of the landmark whose directory the current route sits in. It leads
 * the title because the front is the part a tab strip actually shows, and it
 * is the *landmark's* mark rather than the box's — the box's is the favicon
 * (`DocumentIcon.tsx`). Between them a tab says which box it belongs to and
 * which place inside it you are looking at.
 *
 * The lookup is the same `landmarks.forDir` query the app bar's place pill
 * runs for the same directory, so this is that query's cache entry, not a
 * second request.
 *
 * Only a text symbol can go in a title. A landmark with an image symbol
 * publishes nothing rather than a placeholder — the image already shows in the
 * pill, and a stand-in glyph in the title would claim a mark the card didn't
 * choose.
 */

import { useParams, useRouterState } from "@tanstack/react-router";
import { placeLabel } from "../lib/place-label";
import { usePlaceMark } from "./DocumentTitle";
import { trpc } from "../lib/trpc";

/** Renders nothing; publishes the current place's mark while a box is open. */
export function DocumentPlace() {
  const { boxSlug } = useParams({ strict: false });
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const { dir } = placeLabel({ pathname, boxSlug: boxSlug ?? "" });

  const hereQuery = trpc.landmarks.forDir.useQuery(
    { dir: dir ?? "" },
    { enabled: boxSlug !== undefined && dir !== null },
  );

  const here = dir === null ? null : hereQuery.data?.landmark ?? null;
  usePlaceMark(here === null || here.symbolSrc !== null ? null : here.symbol);

  return null;
}
