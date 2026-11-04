/**
 * Runtime lint check `content-replaced`: while a file's view stays open, the
 * content in it is not unmounted and mounted again. A replacement resets what
 * the reader sees: an embed's state, their place, a selection.
 *
 * `FileView` provides a view scope for its life. Watched content
 * (`useWatchedContent`) registers in the nearest scope. When a (surface, key)
 * live count drops and returns to its earlier level within 2 s while the scope
 * lives, that is a replacement. A count that stays down (content removed, a
 * region hidden for editing) or returns later (hidden and shown again by the
 * person) is not. Closing a tab or navigating unmounts the `FileView`, which
 * discards its scope, so navigation is never counted.
 *
 * Plan: `docs/plans/runtime-lint.md`, Track 2.
 */

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { opaqueId, reportRuntimeLint, type Surface } from "./report";

/** How soon a return counts as a replacement: a same-commit swap or a short loading flash. */
const REPLACED_WITHIN_MS = 2000;

/**
 * Development only: a hot update remounts components on purpose. A return
 * within the window after the last update is not reported.
 */
let lastHotUpdate = Number.NEGATIVE_INFINITY;
if (import.meta.hot) {
  import.meta.hot.on("vite:beforeUpdate", () => {
    lastHotUpdate = performance.now();
  });
}

interface Watched {
  count: number;
  /** Set when the count dropped and has not come back yet. */
  drop: { at: number; level: number } | null;
}

export interface ViewScope {
  /** Registers one mounted occurrence; returns its unregister. */
  register(surface: Surface, key: string): () => void;
}

/** `now` is the clock; tests pass their own. */
export function createViewScope(now: () => number): ViewScope {
  const live = new Map<string, Watched>();
  return {
    register(surface, key) {
      const id = `${surface}|${key}`;
      const watched = live.get(id) ?? { count: 0, drop: null };
      live.set(id, watched);
      watched.count += 1;
      const { drop } = watched;
      if (drop !== null && watched.count >= drop.level) {
        watched.drop = null;
        const gapMs = Math.round(now() - drop.at);
        const hotReload = performance.now() - lastHotUpdate <= REPLACED_WITHIN_MS;
        if (gapMs <= REPLACED_WITHIN_MS && !hotReload) reportRuntimeLint({ check: "content-replaced", surface, content: opaqueId(key), gapMs });
      }
      return () => {
        watched.count -= 1;
        watched.drop ??= { at: now(), level: watched.count + 1 };
      };
    },
  };
}

const ViewScopeContext = createContext<ViewScope | null>(null);

function pageClock(): number {
  return performance.now();
}

/** One file's view: provided by `FileView` around everything it renders. */
export function RuntimeLintViewScope({ children }: { children: ReactNode }) {
  const scope = useMemo(() => createViewScope(pageClock), []);
  return <ViewScopeContext.Provider value={scope}>{children}</ViewScopeContext.Provider>;
}

/** Watch this content for replacement within the enclosing view. `null` watches nothing. */
export function useWatchedContent(surface: Surface, key: string | null): void {
  const scope = useContext(ViewScopeContext);
  useEffect(() => {
    if (scope === null || key === null) return;
    return scope.register(surface, key);
  }, [scope, surface, key]);
}
