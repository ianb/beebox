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
 * **Where the directory comes from matters.** Deriving it from the route alone
 * is not enough: `placeLabel` answers `dir: null` for `/chat` and every other
 * static route, because a chat's real directory is its *session's* context
 * dir, which only the chat knows. The chat publishes it to the app bar
 * (`ChatBarChrome`), so this reads that channel first and falls back to the
 * route. Without that, the longest-lived tabs in the app — chats — never got
 * a mark at all.
 *
 * The lookup is the same `landmarks.forDir` query the app bar's place pill
 * runs for the same directory, so this is that query's cache entry, not a
 * second request.
 *
 * Only a text symbol can go in a title. A landmark with an image symbol
 * publishes nothing rather than a placeholder — the image already shows in the
 * pill, and a stand-in glyph in the title would claim a mark the card didn't
 * choose.
 *
 * Nor does the box ROOT's landmark publish one: that is the box's own mark,
 * and the favicon is already showing it. A tab reading `📦 Chat — Family` next
 * to a 📦 icon says the same thing twice and spends the title's scarcest
 * characters doing it.
 */

import { useParams, useRouterState } from "@tanstack/react-router";
import { placeLabel } from "../lib/place-label";
import { useAppBarPublishedPlace } from "./app-bar-chrome";
import { usePlaceMark } from "./DocumentTitle";
import { trpc } from "../lib/trpc";

/** Renders nothing; publishes the current place's mark while a box is open. */
export function DocumentPlace() {
  const { boxSlug } = useParams({ strict: false });
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const published = useAppBarPublishedPlace();
  const routeDir = placeLabel({ pathname, boxSlug: boxSlug ?? "" }).dir;
  const dir = published?.dir ?? routeDir;

  // "" is the box root, whose landmark is the box's own mark — the favicon has
  // it, so there is nothing for the title to add.
  const wanted = dir === null || dir === "" ? null : dir;

  const hereQuery = trpc.landmarks.forDir.useQuery(
    { dir: wanted ?? "" },
    { enabled: boxSlug !== undefined && wanted !== null },
  );

  const here = wanted === null ? null : hereQuery.data?.landmark ?? null;
  usePlaceMark(here === null || here.symbolSrc !== null ? null : here.symbol);

  return null;
}
