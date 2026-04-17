/**
 * SessionViewer — Read-only view of any agent session.
 *
 * Used when ChatPage receives a `?session=<id>` query param.
 * Fetches history from the backend and renders messages without
 * input controls, voice, or streaming.
 */

import { useState, useEffect, useRef } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { href } from "../lib/routing";
import { getChatHistory, getChatSessions, type SessionEntry, type ChatSessionInfo } from "../api";
import { UserMessage, AssistantMessage, CompactionMessage, SelfNoteMessage, groupMessages } from "./ChatMessages";
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

/**
 * Session list dropdown — shows all known sessions.
 */
export function SessionListButton() {
  const { boxSlug } = useParams({ strict: false });
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const currentSessionId = new URLSearchParams(window.location.search).get("session");

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
        <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-warm-300 rounded-lg shadow-lg z-50 py-1 max-h-80 overflow-y-auto">
          {loading ? (
            <div className="px-3 py-2 text-sm text-warm-500">Loading...</div>
          ) : sessions.length === 0 ? (
            <div className="px-3 py-2 text-sm text-warm-500">No sessions found</div>
          ) : (
            sessions.map((s) => {
              const isViewing = currentSessionId === s.sessionId;
              const linkTo = s.isActive ? `/${boxSlug}/chat` : `/${boxSlug}/chat?session=${s.sessionId}`;
              return (
                <Link
                  key={s.sessionId}
                  to={href(linkTo)}
                  onClick={() => setOpen(false)}
                  {...cbSource("session", s.sessionId)}
                  className={`block px-3 py-2 text-sm hover:bg-warm-100 ${isViewing ? "bg-warm-50 font-medium" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.isActive ? "bg-success" : sourceColor(s.source)}`} />
                    <span className="flex-1 truncate text-warm-800">{s.label}</span>
                    <span className="text-xs text-warm-500 flex-shrink-0">{relativeTime(s.lastUsedAt)}</span>
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

function sourceColor(source: string): string {
  switch (source) {
    case "chat": return "bg-info";
    case "telegram": return "bg-coral";
    case "reactor": return "bg-primary";
    default: return "bg-warm-400";
  }
}

/**
 * Read-only session viewer. Fetches and displays a session's history.
 */
interface ViewerState {
  messages: SessionEntry[];
  loading: boolean;
  error: string | null;
}

export function SessionViewer({ sessionId }: { sessionId: string }) {
  // Key on sessionId so React remounts and resets state when sessionId changes
  return <SessionViewerInner key={sessionId} sessionId={sessionId} />;
}

function SessionViewerInner({ sessionId }: { sessionId: string }) {
  const { boxSlug } = useParams({ strict: false });
  const [state, setState] = useState<ViewerState>({ messages: [], loading: true, error: null });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getChatHistory({ sessionId })
      .then((result) => {
        if (!cancelled) setState({ messages: result.entries, loading: false, error: null });
      })
      .catch((e) => {
        if (!cancelled) setState({ messages: [], loading: false, error: e instanceof Error ? e.message : "Failed to load session" });
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages]);

  if (state.loading) {
    return (
      <div className="h-full flex items-center justify-center text-warm-500">
        Loading session...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-warm-50 to-warm-200" {...cbSource("session", sessionId)}>
      {/* Viewer banner */}
      <div className="px-4 py-2 bg-warm-100 border-b border-warm-300 text-sm text-warm-700 flex items-center gap-2">
        <svg className="w-4 h-4 text-warm-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        <span>Viewing session (read-only)</span>
        <Link to={href(`/${boxSlug}/chat`)} className="ml-auto text-info hover:text-info-dark font-medium">
          Go to active chat &rarr;
        </Link>
      </div>

      {state.error ? (
        <div className="px-4 py-2 bg-danger-50 text-danger-dark text-sm">{state.error}</div>
      ) : null}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 pl-2 sm:pl-4 space-y-1">
        {state.messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-warm-500 text-sm">
            No messages in this session.
          </div>
        ) : null}
        {groupMessages(state.messages).map((group) =>
          group.type === "compaction" ? (
            <CompactionMessage key={group.entries[0].uuid} entries={group.entries} />
          ) : group.type === "self-note" ? (
            <SelfNoteMessage key={group.entries[0].uuid} note={group.note} />
          ) : group.type === "user" ? (
            <UserMessage key={group.entries[0].uuid} entries={group.entries} />
          ) : (
            <AssistantMessage key={group.entries[0].uuid} entries={group.entries} />
          )
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
