/**
 * One chat-session row: label + relative last-activity time, linking into
 * the session, with a side link to the session's husk card.
 *
 * Shared by the two surfaces that list sessions under a landmark — the
 * Landmarks page's merged activity sections and the `view: chat-picker`
 * card (`ChatsLandmarkCard`) — so a session reads the same way in both
 * (docs/implemented-plans/top-nav-ia.md Track D).
 */

import { Link } from "@tanstack/react-router";
import { href, toSearch } from "../../lib/routing";
import { agoOnClock } from "../../lib/relative-time";
import { useNow } from "../../lib/use-now";
import { Text } from "../ui/Text";
import type { RouterOutput } from "../../lib/trpc/client";
import { DeleteChatAction } from "../chat-delete/DeleteChatDialog";
import { cardUrl } from "@shared/card-url";

/** A session as `chat.byLandmark` reports it under a landmark. */
type PickerSession = RouterOutput["chat"]["byLandmark"]["landmarks"][number]["sessions"][number];

/**
 * A session in the trailing unassigned bucket — same shape plus the
 * directory it's bound to, since that bucket spans directories.
 */
type UnassignedSession = RouterOutput["chat"]["byLandmark"]["unassigned"]["sessions"][number];

/** Either kind of row; the unassigned one shows its binding under the label. */
export type SessionRowItem = PickerSession | UnassignedSession;

/**
 * A row carrying a `contextDir` (an unassigned-bucket session) shows its
 * binding under the label; a row listed under its own landmark doesn't
 * carry one, because the section header already says where it lives.
 */
export function SessionRow({ session, boxSlug }: { session: SessionRowItem; boxSlug: string }) {
  const contextDir = "contextDir" in session ? session.contextDir : null;
  // Re-render each minute so the age stays current.
  useNow(60_000);

  return (
    <div className="flex items-stretch gap-1">
      <Link
        to={href(`/${boxSlug}/chat`)}
        search={toSearch({ session: session.sessionId })}
        className="block flex-1 min-w-0 px-3 py-2 rounded border border-subtle hover:border-info-400 hover:bg-info-50/40 transition-colors"
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <Text as="div" size="sm" className="line-clamp-2">
              {session.label}
            </Text>
            {contextDir !== null && contextDir !== "" ? (
              <Text as="div" size="xs" tone="muted" truncate>
                {contextDir}/
              </Text>
            ) : null}
          </div>
          <Text as="span" size="xs" tone="muted" className="flex-shrink-0">
            {agoOnClock(session.lastActivity, "real")}
          </Text>
        </div>
      </Link>
      {/* The session's husk card — the durable, editable face of this chat. */}
      <Link
        to={href(cardUrl(boxSlug, session.huskPath))}
        title="Open this chat's card"
        aria-label="Open this chat's card"
        className="flex items-center px-2 rounded border border-subtle text-warm-400 hover:text-info-dark hover:border-info-400 transition-colors"
      >
        <Text as="span" size="xs">
          card
        </Text>
      </Link>
      <DeleteChatAction
        sessionId={session.sessionId}
        label={session.label}
        huskPath={session.huskPath}
        className="flex items-center rounded border border-subtle px-2 text-warm-400 transition-colors hover:border-danger hover:bg-danger/10 hover:text-danger"
      >
        <span className="sr-only">Delete {session.label}</span>
        <span aria-hidden="true">⋯</span>
      </DeleteChatAction>
    </div>
  );
}
