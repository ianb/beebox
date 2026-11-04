/**
 * Runtime lint check `content-replaced`: while a file's view stays open, the
 * content in it is not unmounted and mounted again. A replacement resets what
 * the reader sees: an embed's state, their place, a selection.
 *
 * `FileView` provides a view scope for its life. Each mounted watched
 * component (`useWatchedContent`) is an occurrence in the nearest scope. When
 * an occurrence showing (surface, key) unmounts and another occurrence starts
 * showing the same (surface, key) within 2 s while the scope lives, that is a
 * replacement. Content that stays gone (removed, a region hidden for editing)
 * or comes back later (hidden and shown again by the person) is not, and a
 * mounted component whose key changes is not an unmount. Closing a tab or navigating unmounts the `FileView`, which
 * discards its scope, so navigation is never counted.
 *
 * Plan: `docs/implemented-plans/runtime-lint.md`, Track 2.
 */

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
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

/** One mounted watched component. Its key can change without it unmounting. */
export interface Occurrence {
  /** What it shows now; `null` watches nothing. A change is not an unmount. */
  watch(surface: Surface, key: string | null): void;
  /** It unmounted. */
  close(): void;
}

export interface ViewScope {
  open(): Occurrence;
}

/** `now` is the clock; tests pass their own. */
export function createViewScope(now: () => number): ViewScope {
  /** Per (surface, key): when an occurrence showing it unmounted, newest last. */
  const drops = new Map<string, number[]>();
  const recent = (id: string, at: number): number[] => (drops.get(id) ?? []).filter((t) => at - t <= REPLACED_WITHIN_MS);
  return {
    open() {
      let current: { surface: Surface; key: string } | null = null;
      return {
        watch(surface, key) {
          if (current?.surface === surface && current.key === key) return;
          current = key === null ? null : { surface, key };
          if (current === null) return;
          // Mounting what an occurrence in this view dropped moments ago is a replacement.
          const id = `${surface}|${current.key}`;
          const at = now();
          const pending = recent(id, at);
          const dropped = pending.shift();
          drops.set(id, pending);
          const hotReload = performance.now() - lastHotUpdate <= REPLACED_WITHIN_MS;
          if (dropped !== undefined && !hotReload) {
            reportRuntimeLint({ check: "content-replaced", surface, content: opaqueId(current.key), gapMs: Math.round(at - dropped) });
          }
        },
        close() {
          if (current === null) return;
          const id = `${current.surface}|${current.key}`;
          const at = now();
          drops.set(id, [...recent(id, at), at]);
          current = null;
        },
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
  const occurrence = useRef<Occurrence | null>(null);
  // Mount and unmount only: a changed key is the same component showing
  // something else, not a remount.
  useEffect(() => {
    if (scope === null) return;
    const opened = scope.open();
    occurrence.current = opened;
    return () => {
      opened.close();
      occurrence.current = null;
    };
  }, [scope]);
  useEffect(() => {
    occurrence.current?.watch(surface, key);
  }, [scope, surface, key]);
}
