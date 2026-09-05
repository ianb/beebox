/**
 * The sessions slot of a landmark section on the merged Landmarks page:
 * the bucket's fresh chats as rows, a "Show older" disclosure for the rest,
 * and a "New chat" action bound to the landmark's directory.
 *
 * Replaces the old resume-or-start Chat button on this surface — with every
 * session listed, "resume" is a row you pick rather than a guess. The switch
 * menu keeps the resume-or-start action (docs/plans/top-nav-ia.md Track D).
 */

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { href, toSearch } from "../../lib/routing";
import { SessionRow, type SessionRowItem } from "../session-pickers/SessionRow";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { ChevronIcon } from "./ChevronIcon";

export function LandmarkSessions({
  bucket,
  boxSlug,
}: {
  bucket: {
    /** Directory a "New chat" here binds to; "" is the box root. */
    dir: string;
    sessions: SessionRowItem[];
    olderSessions: SessionRowItem[];
  };
  boxSlug: string;
}) {
  const [showOlder, setShowOlder] = useState(false);
  const hasOlder = bucket.olderSessions.length > 0;

  return (
    <Stack gap="xs">
      {bucket.sessions.map((s) => (
        <SessionRow key={s.sessionId} session={s} boxSlug={boxSlug} />
      ))}

      {bucket.sessions.length === 0 && !hasOlder ? (
        <Text as="div" size="sm" tone="muted">No chats here yet.</Text>
      ) : null}

      {hasOlder ? (
        <Stack gap="xs">
          <button
            type="button"
            onClick={() => setShowOlder((v) => !v)}
            aria-expanded={showOlder}
            className="flex items-center gap-2 self-start px-2 py-1 -mx-2 rounded text-left hover:bg-warm-100"
          >
            <ChevronIcon open={showOlder} />
            <Text as="span" size="sm">Show older</Text>
            <Text as="span" size="xs" tone="muted">{bucket.olderSessions.length}</Text>
          </button>
          {showOlder ? (
            <Stack gap="xs">
              {bucket.olderSessions.map((s) => (
                <SessionRow key={s.sessionId} session={s} boxSlug={boxSlug} />
              ))}
            </Stack>
          ) : null}
        </Stack>
      ) : null}

      <Link
        to={href(`/${boxSlug}/chat`)}
        search={toSearch({ session: "new", contextDir: bucket.dir })}
        className="self-start px-3 py-1 rounded text-sm font-medium bg-info-50 text-info-dark border border-info-200 hover:bg-info-100 transition-colors"
      >
        New chat
      </Link>
    </Stack>
  );
}
