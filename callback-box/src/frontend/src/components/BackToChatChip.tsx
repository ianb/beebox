/**
 * The way back to the chat you came from.
 *
 * Entering a card or the browse view from a chat has several routes; leaving
 * had none, and on iOS — where the shell has no browser chrome — the only
 * affordance was an invisible swipe gesture
 * (`issues/bugs/2026-08-23-no-consistent-way-back-to-chat.md`).
 *
 * Deliberately **contextual, not a nav item**: it renders only when this tab
 * has actually been in a chat in this box (`lib/last-chat.ts`) and only off
 * the chat page itself. The app bar's no-link-row decision
 * (`docs/plans/top-nav-ia.md` Track C) is about permanent navigation; a
 * return path that exists only when there is something to return to is not
 * that.
 *
 * It returns to *that session*, which is a different promise from the place
 * pill's switch menu — that moves between landmarks and resumes each one's
 * newest chat, which need not be the chat you left.
 */

import { Link } from "@tanstack/react-router";
import { href, toSearch } from "../lib/routing";
import { useLastChat } from "../lib/last-chat";

/** Chevron pointing back the way you came. */
function BackIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  );
}

export function BackToChatChip({ boxSlug, onChatPage }: { boxSlug: string; onChatPage: boolean }) {
  const lastChat = useLastChat(boxSlug);
  // On the chat page there is nothing to go back to, and a box with no slug
  // yet (the router's pre-resolution frame) has no chat URL to build.
  if (onChatPage || boxSlug === "" || lastChat === null) return null;

  const name = lastChat.label ?? "chat";
  return (
    <Link
      id="cb-nav-back-to-chat"
      to={href(`/${boxSlug}/chat`)}
      search={toSearch({ session: lastChat.sessionId })}
      className="shrink-0 min-h-[40px] flex items-center gap-1 rounded-full bg-white/10 border border-white/22 px-2.5 text-xs text-white hover:bg-white/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      title={`Back to ${name}`}
      aria-label={`Back to ${name}`}
    >
      <BackIcon />
      {/* The word stays at every width. A bare chevron beside the place pill
          reads as "collapse", and the pill is the bar's one flexible member —
          it truncates to make room, which is what it is for. The session's own
          name is the tooltip's job; a second growing label would fight it. */}
      <span>Chat</span>
    </Link>
  );
}
