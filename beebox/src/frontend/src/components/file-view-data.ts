/**
 * Loading the bytes a `FileView` renders: card frontmatter/body via tRPC, raw
 * text via `/api/files/*`, and the live-reload subscription that keeps both
 * current. Split out of `FileView.tsx` so the shell there is only the chrome
 * and the renderer choice.
 *
 * The rule this module exists to hold: a failed *refresh* never takes content
 * away. See `lib/file-load-state.ts` for the decision itself.
 */

import { useCallback, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc";
import { ATTACH_SUFFIX } from "@shared/attach-path";
import { apiRawFileUrl, getApiBase } from "../api";
import { useBusSubscription, type RealtimeEvent } from "../hooks/useBusSubscription";
import { useDeferredResync } from "../hooks/useDeferredResync";
import { isBinaryPath, pathExt } from "../lib/binary-files";
import { RequestError } from "../lib/errors";
import { resolveLoadState, type LoadFailure } from "../lib/file-load-state";
import { fetchFromBox, MAX_RETRIES, retryDelayMs, unreachableCause } from "../lib/trpc/transient";
import { busEventData } from "../lib/bus-events";
import type { FileData } from "../renderers";
import { cardLoadRecovery, fileChangeAffectsPath, type CardLoadRecovery } from "../lib/moved-card-recovery";

/* ---------- path classification ---------- */

export function isCardPath(path: string): boolean {
  return path.endsWith(".card");
}

function isDirectoryPath(path: string): boolean {
  // An extension is a good proxy for "this is a file" except for the one
  // directory convention that carries a suffix: every card's attachments live in
  // a sibling `<basename>.attach/`. Classifying those as files sent the shell to
  // fetch a directory's body as text, so every attachment directory in every box
  // rendered "Failed to load: 404" on the card page while listing fine in Browse.
  // Only a path ENDING in the suffix is the directory itself; `foo.attach/photo.jpg`
  // is a file inside it and is classified by its own extension below.
  if (path.endsWith(ATTACH_SUFFIX)) return true;
  return pathExt(path) === "";
}

/**
 * JSON is fetched by its own renderer (renderers/json.tsx), which gates on
 * file size before pulling a potentially-huge body — so, like binary files,
 * the shell must not prefetch it as text.
 */
function isJsonPath(path: string): boolean {
  return pathExt(path) === ".json";
}

/**
 * Whether a failure means "this card does not exist" rather than "the load
 * failed". The view answers the first with `MissingCardState` — an offer to
 * create it — and only the second with an error.
 */
export function isMissingCardFailure(path: string, failure: LoadFailure): boolean {
  return isCardPath(path) && failure.detail.startsWith("Card not found:");
}

/* ---------- data loading ---------- */

export interface LoadResult {
  data: FileData | null;
  loading: boolean;
  /** Set only when there is nothing to show — a first load that failed. */
  error: LoadFailure | null;
  /** Set when `data` is a previous load and the newest refresh failed. */
  stale: LoadFailure | null;
  recovery: CardLoadRecovery | null;
  /** Refetch now: what the stale marker's Refresh action calls. */
  refresh: () => void;
}

export function useFileData(path: string, options?: { recoverMoved?: boolean }): LoadResult {
  const recoverMoved = options?.recoverMoved === true;
  const isCard = isCardPath(path);
  const isDir = isDirectoryPath(path);
  const isBinary = isBinaryPath(path);
  const isJson = isJsonPath(path);
  // JSON, like binary files, is loaded by its own renderer, so the shell
  // passes the path through without prefetching the body.
  const fetchText = !isCard && !isDir && !isBinary && !isJson;
  const apiBase = getApiBase();

  // Card data via tRPC. A restarting box is retried by the tRPC link itself
  // (`lib/trpc/transient.ts`), so this query needs no retry of its own.
  const cardInput = recoverMoved ? { path, recoverMoved: true } : { path };
  const cardQuery = trpc.card.get.useQuery(cardInput, { enabled: isCard });

  // Text content via /api/files/* (managed by React Query). This fetch is not
  // tRPC, so the link's retry does not reach it; it classifies the same way and
  // retries on the same schedule here instead. React Query's count is 0-based.
  const textQuery = useQuery({
    queryKey: ["file-text", path],
    enabled: fetchText,
    queryFn: async ({ signal }) => {
      const resp = await fetchFromBox(apiRawFileUrl(apiBase, path), { signal });
      if (!resp.ok) {
        const message = `Failed to load: ${resp.status} ${resp.statusText}`;
        throw new RequestError(message);
      }
      return resp.text();
    },
    retry: (count, error) => count < MAX_RETRIES && unreachableCause(error) !== null,
    retryDelay: (count) => retryDelayMs(count + 1),
  });

  // Live reload via the box event stream. Resync this file's data on a matching
  // `file-change`, and also on a *re*connect: file-change events are transient
  // and not replayed, so a change that landed while the socket was dropped would
  // otherwise leave the view stale until a manual reload.
  const utils = trpc.useUtils();
  const resync = useCallback(() => {
    // Fire-and-forget: both are react-query refresh triggers whose failure
    // surfaces through the query's own error/isError state, not here.
    if (isCard) {
      void utils.card.get.invalidate({ path });
    } else if (fetchText) {
      void textQuery.refetch();
    }
  }, [path, isCard, fetchText, utils, textQuery]);
  // An errored query is not stale by react-query's reckoning, so `invalidate`
  // alone would not re-run it — the Refresh action asks the query itself.
  const refresh = useCallback(() => {
    if (isCard) {
      void cardQuery.refetch();
    } else if (fetchText) {
      void textQuery.refetch();
    }
  }, [isCard, fetchText, cardQuery, textQuery]);
  // Skip the very first connect — the queries already load on mount, so a resync
  // there is a redundant refetch (and FileView is mounted many-at-once in chat).
  const connectedOnceRef = useRef(false);
  // Reconnect-driven resync is per-instance (one per mounted FileView, i.e.
  // per path), coalesced same-tick and deferred while the tab is hidden — a
  // chat with many embedded files all reconnecting at once shouldn't each
  // fire their own refetch, and a backgrounded tab shouldn't fetch at all.
  const triggerResync = useDeferredResync(resync);
  useBusSubscription({
    onEvent: useCallback((event: RealtimeEvent) => {
      const fileChange = busEventData(event, "file-change");
      if (!fileChange) return;
      // Tolerant compare: normalize both sides so a stray leading slash on this
      // view's path can't silently drop the event (the original refresh bug).
      if (!fileChangeAffectsPath(fileChange, path)) return;
      resync();
    }, [path, resync]),
    onConnect: useCallback(() => {
      if (!connectedOnceRef.current) {
        connectedOnceRef.current = true;
        return;
      }
      triggerResync();
    }, [triggerResync]),
  });

  const cardState = resolveLoadState(cardQuery);
  const textState = resolveLoadState(textQuery);
  const recovery = cardLoadRecovery(cardQuery.error);

  return useMemo<LoadResult>(() => {
    if (isCard) {
      const card = cardState.value;
      if (card === null) {
        return { data: null, loading: cardState.loading, error: cardState.error, stale: null, recovery, refresh };
      }
      return {
        data: {
          path: card.path,
          kind: card.kind,
          type: card.type,
          frontmatter: card.frontmatter,
          body: card.body,
        },
        loading: false,
        error: null,
        stale: cardState.stale,
        recovery,
        refresh,
      };
    }
    if (isDir || isBinary || isJson) {
      return { data: { path }, loading: false, error: null, stale: null, recovery: null, refresh };
    }
    // fetchText. A query with neither value nor failure has not answered yet —
    // the enabled-but-unstarted state the previous code also read as loading.
    if (textState.value === null) {
      const loading = textState.error === null;
      return { data: null, loading, error: textState.error, stale: null, recovery: null, refresh };
    }
    return { data: { path, content: textState.value }, loading: false, error: null, stale: textState.stale, recovery: null, refresh };
  }, [isCard, isDir, isBinary, isJson, path, cardState, textState, recovery, refresh]);
}
