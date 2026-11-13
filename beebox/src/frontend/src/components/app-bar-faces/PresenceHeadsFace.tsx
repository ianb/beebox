/**
 * The heads of the other people who have this chat open, stacked under the
 * profile avatar (docs/chat-presence.md). Nothing when nobody else is here,
 * so a one-person box never sees it. At most two heads; more people show as
 * a `+N` disc whose label names them. Pure, so tests and the theme studio
 * render it with fixed props.
 */

import type { ReactNode } from "react";
import { Avatar } from "../ui/Avatar";
import { List } from "../ui/List";

/** A person in the chat, as the server names them. */
export interface PresenceHead {
  email: string;
  name: string;
}

const MAX_HEADS = 2;

const RING = "ring-2 ring-white shadow-md";

/** `action`: a control under the heads (the call button), shown only when someone is here. */
export function PresenceHeadsFace({ people, action }: { people: readonly PresenceHead[]; action?: ReactNode }) {
  if (people.length === 0) return null;
  const shown = people.slice(0, MAX_HEADS);
  const rest = people.slice(MAX_HEADS);
  return (
    <List
      id="bbx-presence-heads"
      aria-label="Also in this chat"
      gap="xs"
      // eslint-disable-next-line personal-vibe-check/restricted-classes -- not a panel: an always-shown stack of heads hanging under the avatar, with nothing to dismiss, focus, or flip at the viewport edge.
      className="absolute top-full right-0 mt-1.5 z-30 items-center pointer-events-none"
    >
      {shown.map((p) => (
        <li key={p.email} className="pointer-events-auto rounded-full" title={`${p.name} is in this chat`}>
          <Avatar name={p.name} email={p.email} size="sm" fallbackClassName="bg-info-dark text-white" className={RING} />
        </li>
      ))}
      {rest.length > 0 ? (
        <li
          className={`pointer-events-auto w-6 h-6 rounded-full bg-warm-700 text-white text-[0.625rem] font-bold flex items-center justify-center select-none ${RING}`}
          title={`Also here: ${rest.map((p) => p.name).join(", ")}`}
          aria-label={`${rest.length} more: ${rest.map((p) => p.name).join(", ")}`}
        >
          +{rest.length}
        </li>
      ) : null}
      {action ? <li className="pointer-events-auto">{action}</li> : null}
    </List>
  );
}
