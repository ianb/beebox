/**
 * SessionListButton — clock-icon dropdown listing this box's web chat
 * sessions. Each row shows the first user message as a label and the
 * session-id suffix for disambiguation. Clicking a row navigates to
 * `/chat?session=<id>` so ChatPage can route into it.
 *
 * The list is landmark-aware but never landmark-*filtered*: the chats bound to
 * the landmark you're chatting in come first under its name, and everything
 * else follows under "Other chats", tagged with where it lives. Every chat in
 * the box stays one scroll away — prominence, not scoping.
 */

import { useState, useEffect } from "react";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { href, toSearch } from "../../lib/routing";
import { getChatSessions, type ChatSessionInfo } from "../../api";
import { cbSource } from "../../lib/source-tag";
import { Dropdown, useDropdownClose } from "../ui/Dropdown";
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

export function SessionListButton({ contextDir }: { contextDir: string | null }) {
  const { boxSlug } = useParams({ strict: false });
  // eslint-disable-next-line no-restricted-syntax -- `strict: false` collapses the search type across every route; this component only ever renders under routes that carry an optional `session` string param, matching the ChatPage/HistoryPage convention.
  const search = useSearch({ strict: false }) as { session?: string };
  const currentSessionId = search.session ?? null;

  return (
    <Dropdown
      align="right"
      width="w-[28rem]"
      trigger={({ toggle, ariaProps }) => (
        <button
          onClick={toggle}
          className="p-1.5 rounded hover:bg-white/20 text-white/80 hover:text-white"
          title="Session history"
          {...ariaProps}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      )}
    >
      <SessionListMenu
        boxSlug={boxSlug ?? ""}
        currentSessionId={currentSessionId}
        contextDir={contextDir}
      />
    </Dropdown>
  );
}

/**
 * Menu body — rendered inside the Dropdown, so it mounts each time the menu
 * opens (which is when we lazy-fetch the session list) and can close the
 * Dropdown when a row is selected.
 */
function SessionListMenu({
  boxSlug,
  currentSessionId,
  contextDir,
}: {
  boxSlug: string;
  currentSessionId: string | null;
  contextDir: string | null;
}) {
  const [sessions, setSessions] = useState<ChatSessionInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getChatSessions()
      .then((result) => setSessions(result.sessions))
      .catch((_e) => console.error("Failed to load sessions:", _e))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="px-3 py-2 text-sm text-warm-500">Loading...</div>;
  }
  if (sessions.length === 0) {
    return <div className="px-3 py-2 text-sm text-warm-500">No sessions yet</div>;
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
  const rowProps = { boxSlug, currentSessionId };

  if (layout.kind === "flat") {
    return <SessionRows sessions={layout.sessions} showLandmark={layout.showLandmark} {...rowProps} />;
  }
  return (
    <>
      <SessionGroup label={layout.hereLabel}>
        <SessionRows sessions={layout.here} showLandmark={false} {...rowProps} />
      </SessionGroup>
      <SessionGroup label="Other chats">
        <SessionRows sessions={layout.elsewhere} showLandmark {...rowProps} />
      </SessionGroup>
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
            {...cbSource("session", s.sessionId)}
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
