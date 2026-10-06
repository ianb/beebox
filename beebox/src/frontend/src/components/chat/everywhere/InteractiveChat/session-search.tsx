/**
 * Transcript search for the "Recent chats" panel: the debounced field state
 * and the result rows. Split from `SessionListPanel.tsx` to keep that file
 * under the line cap.
 *
 * Results are one row per CHAT (the server folds chunk hits), each landing
 * at the matched message via `/chat?session=<id>&m=<anchor>`. Text-only
 * search by design (docs/plans/chat-search.md): labels are joined from the
 * live session list when it has loaded, falling back to the indexed title.
 */

import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { href, toSearch } from "../../../../lib/routing";
import {
  searchChatTranscripts,
  type ChatSearchHitInfo,
  type ChatSessionInfo,
} from "../../../../api";
import { bbxSource } from "../../../../lib/source-tag";
import { useDropdownClose } from "../../../ui/Dropdown";
import { Highlight } from "../../../search/SearchResults";

/**
 * Format a date string as relative time (e.g., "2h ago", "3d ago").
 */
export function relativeTime(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** A query short enough to act on (the debounce has settled on it). */
const MIN_QUERY = 2;
const SEARCH_DEBOUNCE_MS = 300;

type SearchState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "done"; results: ChatSearchHitInfo[]; truncated: boolean; stale: boolean };

/**
 * Debounced transcript search: typing updates the field instantly, the index is
 * asked at most every 300ms.
 *
 * The input's `value` must bind to {@link field}, never to `query`: `query` is
 * the debounced value, and a controlled input bound to it gets reset by React
 * to the stale query after every keystroke — characters vanish and stagger
 * back as the debounce settles, which is exactly the "typing is slow and
 * painful" bug this hook's shape guards against.
 */
export function useChatSearch(): {
  active: boolean;
  /** The raw input text — what the field's `value` binds to. */
  field: string;
  /** The settled query the search ran with. */
  query: string;
  state: SearchState;
  setField: (value: string) => void;
  /** Reset the field AND the settled query — Escape must not wait out the debounce. */
  clear: () => void;
  retry: () => void;
} {
  const [field, setField] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ kind: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(field.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [field]);

  useEffect(() => {
    if (query.length < MIN_QUERY) return;
    setState({ kind: "loading" });
    let cancelled = false;
    searchChatTranscripts({ query, limit: 8 })
      .then((result) => {
        if (cancelled) return;
        setState({ kind: "done", results: result.results, truncated: result.truncated, stale: result.stale });
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("Failed to search chats:", e);
        setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [query, nonce]);

  return {
    active: query.length >= MIN_QUERY,
    field,
    query,
    state,
    setField,
    clear: () => {
      setField("");
      setQuery("");
    },
    retry: () => setNonce((n) => n + 1),
  };
}

/** Transcript search results: one row per chat, landing at the matched message. */
export function ChatSearchRows({ query, state, sessions, boxSlug, currentSessionId, onRetry }: {
  query: string;
  state: SearchState;
  sessions: ChatSessionInfo[];
  boxSlug: string;
  currentSessionId: string | null;
  onRetry: () => void;
}) {
  const close = useDropdownClose();
  if (state.kind === "loading") {
    return <div className="px-3 py-2 text-sm text-warm-500">Searching…</div>;
  }
  if (state.kind === "error") {
    return (
      <div className="px-3 py-2 text-sm text-danger-dark">
        Couldn&rsquo;t search chats.{" "}
        <button type="button" onClick={() => onRetry()} className="underline hover:no-underline">
          Retry
        </button>
      </div>
    );
  }
  if (state.results.length === 0) {
    return <div className="px-3 py-2 text-sm text-warm-500">No chats match.</div>;
  }
  const labelFor = (hit: ChatSearchHitInfo): string => {
    const live = sessions.find((s) => s.sessionId === hit.sessionId)?.label;
    if (live !== undefined && live !== "") return live;
    return hit.title !== "" ? hit.title : hit.sessionId.slice(0, 8);
  };
  return (
    <div role="group" aria-label="Chat search results">
      {state.results.map((hit) => {
        const isViewing = currentSessionId === hit.sessionId;
        return (
          <Link
            key={hit.sessionId}
            role="menuitem"
            to={href(`/${boxSlug}/chat`)}
            search={toSearch({ session: hit.sessionId, m: hit.anchor })}
            onClick={close}
            {...bbxSource("session", hit.sessionId)}
            className={`block px-3 py-2 text-sm hover:bg-warm-100 ${isViewing ? "bg-warm-50" : ""}`}
          >
            <div className="flex items-baseline gap-2">
              <span className={`flex-1 truncate ${isViewing ? "font-medium text-warm-900" : "text-warm-800"}`}>
                {labelFor(hit)}
              </span>
              <span className="text-xs text-warm-500 flex-shrink-0 font-mono">{hit.sessionId.slice(0, 8)}</span>
            </div>
            <div className="mt-0.5 text-xs text-warm-500 line-clamp-2">
              <Highlight text={hit.snippet} query={query} />
            </div>
            <div className="mt-0.5 text-xs text-warm-400">{relativeTime(hit.created)}</div>
          </Link>
        );
      })}
      {state.stale ? <div className="px-3 py-1 text-xs text-warm-400">Index busy — results may be stale.</div> : null}
      {state.truncated ? <div className="px-3 py-1 text-xs text-warm-400">More matches than shown.</div> : null}
    </div>
  );
}
