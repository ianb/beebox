/**
 * The sessions slot of a landmark section on the merged Landmarks page:
 * the bucket's fresh chats as rows, a "Show older" disclosure for the rest,
 * and a "New chat" action bound to the landmark's directory.
 *
 * Replaces the old resume-or-start Chat button on this surface — with every
 * session listed, "resume" is a row you pick rather than a guess. The switch
 * menu keeps the resume-or-start action (docs/implemented-plans/top-nav-ia.md Track D).
 */

import { useState } from "react";
import { toSearch } from "../../lib/routing";
import { ButtonLink } from "../ui/Button";
import { SessionRow, type SessionRowItem } from "../session-pickers/SessionRow";
import { Stack } from "../ui/Stack";
import { Hint } from "../ui/Hint";
import { ExpanderButton } from "./ChevronIcon";

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
        <Hint>No chats here yet.</Hint>
      ) : null}

      {hasOlder ? (
        <Stack gap="xs">
          <ExpanderButton open={showOlder} onToggle={() => setShowOlder((v) => !v)} label="Show older" count={bucket.olderSessions.length} />
          {showOlder ? (
            <Stack gap="xs">
              {bucket.olderSessions.map((s) => (
                <SessionRow key={s.sessionId} session={s} boxSlug={boxSlug} />
              ))}
            </Stack>
          ) : null}
        </Stack>
      ) : null}

      <ButtonLink to={`/${boxSlug}/chat`} search={toSearch({ session: "new", contextDir: bucket.dir })} size="sm" className="self-start">
        New chat
      </ButtonLink>
    </Stack>
  );
}
