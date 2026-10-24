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
import { agoOnClock } from "../../../../lib/relative-time";
import { useNow } from "../../../../lib/use-now";
import { sessionIdHint } from "./session-list-grouping";
import { StatusMessage } from "../../../ui/StatusMessage";

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
  // Re-render each minute so the hit ages stay current.
  useNow(60_000);
  if (state.kind === "loading") {
    return <StatusMessage variant="menu">Searching…</StatusMessage>;
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
    return <div className="px-3 py-2 text-sm text-warm-700">No chats match.</div>;
  }
  const labelFor = (hit: ChatSearchHitInfo): string => {
    const live = sessions.find((s) => s.sessionId === hit.sessionId)?.label;
    if (live !== undefined && live !== "") return live;
    return hit.title !== "" ? hit.title : hit.sessionId.slice(0, 8);
  };
  const labelled = state.results.map((hit) => ({ hit, sessionId: hit.sessionId, label: labelFor(hit) }));
  return (
    <div role="group" aria-label="Chat search results">
      {labelled.map(({ hit, label }) => {
        const isViewing = currentSessionId === hit.sessionId;
        const idHint = sessionIdHint({ sessionId: hit.sessionId, label }, labelled);
        return (
          <Link
            key={hit.sessionId}
            role="menuitem"
            to={href(`/${boxSlug}/chat`)}
            search={toSearch({ session: hit.sessionId, m: hit.anchor })}
            onClick={close}
            title={`Session ${hit.sessionId}`}
            {...bbxSource("session", hit.sessionId)}
            className={`block px-3 py-2 text-sm hover:bg-warm-100 ${isViewing ? "bg-warm-50" : ""}`}
          >
            <div className="flex items-baseline gap-2">
              <span className={`flex-1 truncate ${isViewing ? "font-medium text-warm-900" : "text-warm-800"}`}>
                {label}
              </span>
              {idHint === null ? null : <span className="text-xs text-warm-700 flex-shrink-0 font-mono">{idHint}</span>}
            </div>
            <div className="mt-0.5 text-xs text-warm-700 line-clamp-2">
              <Highlight text={hit.snippet} query={query} />
            </div>
            <div className="mt-0.5 text-xs text-warm-400">{agoOnClock(hit.created, "real")}</div>
          </Link>
        );
      })}
      {state.stale ? <div className="px-3 py-1 text-xs text-warm-400">Index busy — results may be stale.</div> : null}
      {state.truncated ? <div className="px-3 py-1 text-xs text-warm-400">More matches than shown.</div> : null}
    </div>
  );
}
