/**
 * The heads of the other people who have this chat open, stacked under the
 * profile avatar (docs/chat-presence.md). Nothing when nobody else is here,
 * so a one-person box never sees it. At most two heads; more people show as
 * a `+N` disc whose label names them. A head carries a badge while that
 * person is typing or dictating. Pure, so tests and the theme studio
 * render it with fixed props.
 */

import type { ReactNode } from "react";
import type { Composing } from "@core/chat/presence/types.js";
import { Avatar } from "../ui/Avatar";
import { List } from "../ui/List";

/** A person in the chat, as the server names them. */
export interface PresenceHead {
  email: string;
  name: string;
  /** What they are doing in the composer now, if anything. */
  doing?: Composing;
}

/** How a head is named: who, and what they are doing. */
function headLabel(p: PresenceHead): string {
  if (p.doing === "typing") return `${p.name} is typing`;
  if (p.doing === "dictating") return `${p.name} is dictating`;
  return `${p.name} is in this chat`;
}

/** Three dots for typing, a mic for dictating, in a small disc at the head's lower left. */
function ComposingBadge({ doing }: { doing: Composing }) {
  return (
    <span aria-hidden="true" className="absolute -bottom-1 -left-1.5 h-3.5 min-w-3.5 px-0.5 rounded-full bg-white text-warm-800 shadow flex items-center justify-center gap-px">
      {doing === "typing" ? (
        [0, 1, 2].map((i) => <span key={i} className="w-0.5 h-0.5 rounded-full bg-current motion-safe:animate-pulse" />)
      ) : (
        <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      )}
    </span>
  );
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
        <li key={p.email} className="relative pointer-events-auto rounded-full" title={headLabel(p)} aria-label={headLabel(p)}>
          <Avatar name={p.name} email={p.email} size="sm" fallbackClassName="bg-info-dark text-white" className={RING} />
          {p.doing === undefined ? null : <ComposingBadge doing={p.doing} />}
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
