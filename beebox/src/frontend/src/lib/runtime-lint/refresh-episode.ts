/**
 * Runtime lint check `refresh-failed`, reported as an episode: content on
 * screen could not be refreshed (the "Not up to date" notice), then it
 * recovered. A box that keeps failing its reads shows as a run of these.
 * A path change or unmount ends the episode with no record: that is the view
 * moving on, not a recovery.
 *
 * Plan: `docs/plans/runtime-lint.md`, Track 2.
 */

import { useEffect, useRef } from "react";
import { unreachableCause } from "../trpc/transient";
import { opaqueId, reportRuntimeLint, type RefreshFailureKind, type Surface } from "./report";

/** The failure's kind, from the query error itself (never its message text). */
export function refreshFailureKind(error: unknown): RefreshFailureKind {
  if (unreachableCause(error) !== null) return "unreachable";
  const code: unknown = typeof error === "object" && error !== null && "data" in error
    && typeof error.data === "object" && error.data !== null && "code" in error.data ? error.data.code : undefined;
  return code === "NOT_FOUND" ? "not-found" : "other";
}

export function useRefreshEpisode({ path, surface, failing, error }: {
  path: string;
  surface: Surface;
  /** The view shows earlier content because the newest refresh failed. */
  failing: boolean;
  error: unknown;
}): void {
  const episode = useRef<{ path: string; at: number } | null>(null);
  useEffect(() => {
    if (episode.current !== null && episode.current.path !== path) episode.current = null;
    if (failing && episode.current === null) {
      episode.current = { path, at: performance.now() };
      reportRuntimeLint({ check: "refresh-failed", phase: "failed", surface, content: opaqueId(path), kind: refreshFailureKind(error) });
    } else if (!failing && episode.current !== null) {
      const durationMs = Math.round(performance.now() - episode.current.at);
      episode.current = null;
      reportRuntimeLint({ check: "refresh-failed", phase: "recovered", surface, content: opaqueId(path), durationMs });
    }
  }, [path, surface, failing, error]);
}
