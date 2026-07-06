/**
 * SessionListButton — clock-icon dropdown listing this box's web chat
 * sessions. Each row shows the first user message as a label and the
 * session-id suffix for disambiguation. Clicking a row navigates to
 * `/chat?session=<id>` so ChatPage can route into it.
 */

import { useState, useEffect, useRef } from "react";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { href, toSearch } from "../lib/routing";
import { getChatSessions, type ChatSessionInfo } from "../api";
import { cbSource } from "../lib/source-tag";

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

export function SessionListButton() {
  const { boxSlug } = useParams({ strict: false });
  const search = useSearch({ strict: false }) as { session?: string };
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const currentSessionId = search.session ?? null;

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleOpen = () => {
    setOpen(!open);
    if (!open) {
      setLoading(true);
      getChatSessions()
        .then((result) => setSessions(result.sessions))
        .catch((_e) => console.error("Failed to load sessions:", _e))
        .finally(() => setLoading(false));
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={handleOpen}
        className="p-1.5 rounded hover:bg-white/20 text-white/80 hover:text-white"
        title="Session history"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
      {open ? (
        <div className="absolute right-0 top-full mt-1 w-[28rem] max-w-[calc(100vw-1rem)] bg-white border border-warm-300 rounded-lg shadow-lg z-50 py-1 max-h-96 overflow-y-auto">
          {loading ? (
            <div className="px-3 py-2 text-sm text-warm-500">Loading...</div>
          ) : sessions.length === 0 ? (
            <div className="px-3 py-2 text-sm text-warm-500">No sessions yet</div>
          ) : (
            sessions.map((s) => {
              const isViewing = currentSessionId === s.sessionId;
              const idSuffix = s.sessionId.slice(0, 8);
              return (
                <Link
                  key={s.sessionId}
                  to={href(`/${boxSlug}/chat`)}
                  search={toSearch({ session: s.sessionId })}
                  onClick={() => setOpen(false)}
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
                  </div>
                </Link>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
