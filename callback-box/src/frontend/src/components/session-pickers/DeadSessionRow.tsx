/**
 * One dead chat's row: a chat that exists as a card but has no transcript on
 * this machine (`docs/plans/chat-session-identity.md`, Track 3).
 *
 * A sibling of `SessionRow` rather than a mode of it: every affordance on that
 * row — the label link, the resume — goes to `/chat?session=`, and there is
 * nothing there to open. This row's only destination is the card.
 */

import { Link } from "@tanstack/react-router";
import { href } from "../../lib/routing";
import { Text } from "../ui/Text";
import { groupByTranscriptState } from "../../lib/transcript-state";
import type { RouterOutput } from "../../lib/trpc";

/** A dead chat as `chat.byLandmark` reports it under a landmark. */
export type DeadSessionRowItem = RouterOutput["chat"]["byLandmark"]["landmarks"][number]["dead"][number];

export function DeadSessionRow({ session, boxSlug }: { session: DeadSessionRowItem; boxSlug: string }) {
  return (
    <Link
      to={href(`/${boxSlug}/browse/${session.huskPath}`)}
      className="block px-3 py-2 rounded border border-subtle hover:border-info-400 hover:bg-info-50/40 transition-colors"
    >
      <Text as="div" size="sm" tone="muted" className="line-clamp-2">
        {session.label}
      </Text>
    </Link>
  );
}

/**
 * The dead chats under one landmark, grouped by why they are dead. Renders
 * nothing at all when there are none — an empty "Expired" heading would be
 * noise on the great majority of landmarks.
 */
export function DeadSessionSection({ sessions, boxSlug }: { sessions: readonly DeadSessionRowItem[]; boxSlug: string }) {
  if (sessions.length === 0) return null;
  return (
    <>
      {groupByTranscriptState(sessions).map((group) => (
        <div key={group.label}>
          <Text as="div" size="xs" tone="muted" weight="medium" className="px-1 pb-1 uppercase tracking-wide">
            {group.label}
          </Text>
          <div className="flex flex-col gap-1">
            {group.rows.map((s) => (
              <DeadSessionRow key={s.sessionId} session={s} boxSlug={boxSlug} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
