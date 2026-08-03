/**
 * One chat-session row: label + relative last-activity time, linking into
 * the session, with a side link to the session's husk card.
 *
 * Shared by the two surfaces that list sessions under a landmark — the
 * Landmarks page's merged activity sections and the `view: chat-picker`
 * card (`ChatsLandmarkCard`) — so a session reads the same way in both
 * (docs/plans/top-nav-ia.md Track D).
 */

import { Link } from "@tanstack/react-router";
import { href, toSearch } from "../../lib/routing";
import { Text } from "../ui/Text";
import type { RouterOutput } from "../../lib/trpc";

/** A session as `chat.byLandmark` reports it under a landmark. */
type PickerSession = RouterOutput["chat"]["byLandmark"]["landmarks"][number]["sessions"][number];

/**
 * A session in the trailing unassigned bucket — same shape plus the
 * directory it's bound to, since that bucket spans directories.
 */
type UnassignedSession = RouterOutput["chat"]["byLandmark"]["unassigned"]["sessions"][number];

/** Either kind of row; the unassigned one shows its binding under the label. */
export type SessionRowItem = PickerSession | UnassignedSession;

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const ms = Date.now() - then;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * A row carrying a `contextDir` (an unassigned-bucket session) shows its
 * binding under the label; a row listed under its own landmark doesn't
 * carry one, because the section header already says where it lives.
 */
export function SessionRow({
  session,
  boxSlug,
}: {
  session: SessionRowItem;
  boxSlug: string;
}) {
  const contextDir = "contextDir" in session ? session.contextDir : null;

  return (
    <div className="flex items-stretch gap-1">
      <Link
        to={href(`/${boxSlug}/chat`)}
        search={toSearch({ session: session.sessionId })}
        className="block flex-1 min-w-0 px-3 py-2 rounded border border-subtle hover:border-info-400 hover:bg-info-50/40 transition-colors"
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <Text as="div" size="sm" className="line-clamp-2">{session.label}</Text>
            {contextDir !== null && contextDir !== "" ? (
              <Text as="div" size="xs" tone="muted" truncate>{contextDir}/</Text>
            ) : null}
          </div>
          <Text as="span" size="xs" tone="muted" className="flex-shrink-0">
            {formatRelativeTime(session.lastActivity)}
          </Text>
        </div>
      </Link>
      {/* The session's husk card — the durable, editable face of this chat. */}
      <Link
        to={href(`/${boxSlug}/browse/${session.huskPath}`)}
        title="Open this chat's card"
        aria-label="Open this chat's card"
        className="flex items-center px-2 rounded border border-subtle text-warm-400 hover:text-info-dark hover:border-info-400 transition-colors"
      >
        <Text as="span" size="xs">card</Text>
      </Link>
    </div>
  );
}
