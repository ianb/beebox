/**
 * SessionListPanel — the "Recent chats" sub-panel body.
 *
 * Rendered by `SessionChip`'s "Recent chats ›" row. The unified bar briefly
 * retired it (docs/implemented-plans/top-nav-ia.md Track C2) on the theory
 * that the place pill's switch menu covered finding a session — it doesn't:
 * that menu switches *landmarks* and resumes each one's newest chat, so a
 * sibling session in the landmark you're already in had no route back short
 * of the Landmarks page. Restored where it always was, in the chat's own menu
 * (boxholder call, 2026-08-07).
 *
 * Lists this box's web chat sessions; each row shows
 * the first user message as a label and the session-id suffix for
 * disambiguation. Clicking a row navigates to `/chat?session=<id>` so
 * ChatPage can route into it.
 *
 * The list is landmark-aware but never landmark-*filtered*: the chats bound to
 * the landmark you're chatting in come first under its name, and everything
 * else follows under "Other chats", tagged with where it lives. Every chat in
 * the box stays one scroll away — prominence, not scoping.
 *
 * Owns its own fetch/error/retry state: a load failure renders an explicit
 * error row with a retry affordance, distinct from the empty "No sessions
 * yet" state (a caught-and-cleared load used to fall through to the empty
 * state, indistinguishable from a genuinely empty box).
 */

import { useState, useEffect, useCallback } from "react";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { href, toSearch } from "../../lib/routing";
import { getChatSessions, type ChatSessionInfo, type DeadChatInfo } from "../../api";
import { groupByTranscriptState } from "../../lib/transcript-state";
import { bbxSource } from "../../lib/source-tag";
import { useDropdownClose } from "../ui/Dropdown";
import { layoutSessionList } from "./session-list-grouping";

/**
 * Format a date string as relative time (e.g., "2h ago", "3d ago").
 */
function relativeTime(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "loaded"; sessions: ChatSessionInfo[]; dead: DeadChatInfo[] };

export function SessionListPanel({ contextDir }: { contextDir: string | null }) {
  const { boxSlug } = useParams({ strict: false });
  // eslint-disable-next-line no-restricted-syntax -- `strict: false` collapses the search type across every route; this component only ever renders under routes that carry an optional `session` string param, matching the ChatPage/HistoryPage convention.
  const search = useSearch({ strict: false }) as { session?: string };
  const currentSessionId = search.session ?? null;
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(() => {
    setState({ kind: "loading" });
    getChatSessions()
      .then((result) => setState({ kind: "loaded", sessions: result.sessions, dead: result.dead }))
      .catch((e) => {
        console.error("Failed to load sessions:", e);
        setState({ kind: "error" });
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.kind === "loading") {
    return <div className="px-3 py-2 text-sm text-warm-500">Loading...</div>;
  }
  if (state.kind === "error") {
    return (
      <div className="px-3 py-2 text-sm text-danger-dark">
        Couldn&rsquo;t load chats.{" "}
        <button id="bbx-session-list-retry" type="button" onClick={load} className="underline hover:no-underline">
          Retry
        </button>
      </div>
    );
  }
  const { sessions, dead } = state;
  if (sessions.length === 0 && dead.length === 0) {
    return <div className="px-3 py-2 text-sm text-warm-500">No chats yet</div>;
  }

  // Prefer the current session's own row over the `contextDir` prop: a resumed
  // root-bound chat resolves to `null` there (the history file doesn't persist
  // an empty binding, and `directoryFor` can't tell "root" from "unknown"), and
  // the prop is only populated for a brand-new chat anyway. The row's
  // `contextDir` comes from the husk and is already normalized, so it matches
  // the other rows exactly.
  const activeRow = sessions.find((s) => s.sessionId === currentSessionId);
  const layout = layoutSessionList({
    sessions,
    contextDir: activeRow?.contextDir ?? contextDir,
  });
  const rowProps = { boxSlug: boxSlug ?? "", currentSessionId };

  return (
    <>
      {layout.kind === "flat" ? (
        <SessionRows sessions={layout.sessions} showLandmark={layout.showLandmark} {...rowProps} />
      ) : (
        <>
          <SessionGroup label={layout.hereLabel}>
            <SessionRows sessions={layout.here} showLandmark={false} {...rowProps} />
          </SessionGroup>
          <SessionGroup label="Other chats">
            <SessionRows sessions={layout.elsewhere} showLandmark {...rowProps} />
          </SessionGroup>
        </>
      )}
      <DeadSessionGroups dead={dead} boxSlug={boxSlug ?? ""} />
    </>
  );
}

/**
 * The chats that no longer have a transcript here, after every live one and
 * under a heading saying why (`docs/implemented-plans/chat-session-identity.md`, Track 3).
 * They were invisible before — a chat whose transcript expired simply left the
 * list, so the box looked like it had forgotten the conversation entirely.
 *
 * Each row goes to the husk card: there is nothing at `/chat?session=` to open.
 */
function DeadSessionGroups({ dead, boxSlug }: { dead: DeadChatInfo[]; boxSlug: string }) {
  const close = useDropdownClose();
  if (dead.length === 0) return null;
  return (
    <>
      {groupByTranscriptState(dead).map((group) => (
        <SessionGroup key={group.label} label={group.label}>
          {group.rows.map((s) => (
            <Link
              key={s.sessionId}
              role="menuitem"
              to={href(`/${boxSlug}/browse/${s.huskPath}`)}
              onClick={close}
              className="block px-3 py-2 text-sm text-warm-500 hover:bg-warm-100"
            >
              <div className="flex items-baseline gap-2">
                <span className="flex-1 truncate">{s.label}</span>
                <span className="text-xs flex-shrink-0 font-mono">{s.sessionId.slice(0, 8)}</span>
              </div>
            </Link>
          ))}
        </SessionGroup>
      ))}
    </>
  );
}

/**
 * A labelled run of rows. The heading is `aria-hidden` because the group's
 * `aria-label` already announces it — otherwise a screen reader reads the
 * name twice on entering the group.
 */
function SessionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <div
        aria-hidden="true"
        className="px-3 py-1 bg-warm-50 border-y border-warm-100 text-xs font-medium uppercase tracking-wide text-warm-500 truncate"
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function SessionRows({
  sessions,
  boxSlug,
  currentSessionId,
  showLandmark,
}: {
  sessions: ChatSessionInfo[];
  boxSlug: string;
  currentSessionId: string | null;
  showLandmark: boolean;
}) {
  const close = useDropdownClose();
  return (
    <>
      {sessions.map((s) => {
        const isViewing = currentSessionId === s.sessionId;
        const idSuffix = s.sessionId.slice(0, 8);
        return (
          <Link
            key={s.sessionId}
            role="menuitem"
            to={href(`/${boxSlug}/chat`)}
            search={toSearch({ session: s.sessionId })}
            onClick={close}
            {...bbxSource("session", s.sessionId)}
            className={`block px-3 py-2 text-sm hover:bg-warm-100 ${isViewing ? "bg-warm-50" : ""}`}
          >
            <div className="flex items-baseline gap-2">
              <span className={`flex-1 truncate ${isViewing ? "font-medium text-warm-900" : "text-warm-800"}`}>
                {s.label}
              </span>
              <span className="text-xs text-warm-500 flex-shrink-0 font-mono">{idSuffix}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              {s.isActive ? (
                <span className="text-xs text-success-dark">active</span>
              ) : null}
              <span className="text-xs text-warm-500">{relativeTime(s.lastUsedAt)}</span>
              {showLandmark ? (
                <span className="text-xs text-warm-500 truncate">in {s.landmarkLabel}</span>
              ) : null}
            </div>
          </Link>
        );
      })}
    </>
  );
}
