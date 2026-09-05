/**
 * `/chats` deep link.
 *
 * Chats are no longer a page of their own — the Landmarks page lists every
 * landmark's chats alongside its links, plus the landmark-less ones
 * (docs/plans/top-nav-ia.md Track D). This route survives as a redirect for
 * bookmarks and older links. `ChatsPicker` still renders as a
 * `view: chat-picker` card.
 */

import { Navigate, useParams } from "@tanstack/react-router";
import { href } from "../../lib/routing";

export function ChatsPage() {
  const { boxSlug } = useParams({ strict: false });
  return <Navigate to={href(`/${boxSlug ?? ""}/landmarks`)} replace />;
}
