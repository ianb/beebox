/**
 * Card-type → custom-view bindings.
 *
 * A box view that exports `rendersCardTypes = ["sandbox"]` becomes the
 * default renderer wherever cards of that type display (card pages, chat
 * embeds, peeks — everything that renders through FileView). The bindings
 * come from the views listing; one fetch per page load, memoized — views
 * change rarely, and a reload picks up new ones.
 *
 * One view per type: when several views claim the same type, the first by
 * slug order wins (deterministic; the views listing is directory order).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { trpcClient } from "./trpc";
import { busEventData } from "./bus-events";
import { viewSlugFromSourcePath } from "./view-source-path";
import { useBusSubscription, type RealtimeEvent } from "../hooks/useBusSubscription";

export interface CardViewBinding {
  slug: string;
  name: string;
}

/**
 * Single-flight async cache: concurrent `load()` calls share one in-flight
 * fetch, and `invalidate()` clears the cache synchronously — not deferred to
 * a microtask — so a `load()` called immediately after an `invalidate()` in
 * the same tick always sees the cleared cache and starts a fresh fetch. (An
 * earlier revision routed `invalidate()` through the shared `deferred-resync`
 * coalescing helper, which delayed the clear to a microtask; both call sites
 * below call `load()` synchronously right after invalidating, so they kept
 * reading the pre-invalidation promise and nothing ever reloaded. Repeated
 * `invalidate()` calls are idempotent — clearing an already-null cache is a
 * no-op — so no coalescing is needed for the clear itself.) Exported so this
 * exact same-tick sequencing can be asserted directly, without going through
 * `trpcClient`.
 */
export function createSingleFlightCache<T>(fetcher: () => Promise<T>): {
  load: () => Promise<T>;
  invalidate: () => void;
} {
  let promise: Promise<T> | null = null;
  return {
    load: () => {
      promise ??= fetcher();
      return promise;
    },
    invalidate: () => {
      promise = null;
    },
  };
}

const bindingsCache = createSingleFlightCache<Map<string, CardViewBinding>>(async () => {
  const map = new Map<string, CardViewBinding>();
  try {
    const metas = await trpcClient.views.list.query();
    for (const meta of [...metas].toSorted((a, b) => a.slug.localeCompare(b.slug))) {
      for (const type of meta.rendersCardTypes) {
        if (!map.has(type)) map.set(type, { slug: meta.slug, name: meta.name });
      }
    }
  } catch (e) {
    // No views listing (older server, network hiccup): cards simply fall
    // back to the built-in renderers. Log so a real outage is visible.
    console.warn("view-bindings: could not load views listing", e);
  }
  return map;
});

function fetchBindings(): Promise<Map<string, CardViewBinding>> {
  return bindingsCache.load();
}

/** Drop the memoized bindings so the next `fetchBindings()` re-reads `/api/views`. */
function invalidateBindings(): void {
  bindingsCache.invalidate();
}

/** The custom view bound to a card type, or null (also null while loading). */
export function useCardViewBinding(type: string | undefined): CardViewBinding | null {
  const [binding, setBinding] = useState<CardViewBinding | null>(null);
  // Monotonic request id so only the latest load() applies its result: an
  // earlier `/api/views` response that resolves out of order (rapid view edits)
  // can't clobber a newer binding, and `mounted` blocks a set after unmount.
  const reqRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(() => {
    if (type === undefined) {
      setBinding(null);
      return;
    }
    const req = (reqRef.current += 1);
    void fetchBindings().then((map) => {
      if (mountedRef.current && req === reqRef.current) setBinding(map.get(type) ?? null);
    });
  }, [type]);

  useEffect(() => load(), [load]);

  // A view edit can change which view renders a card type (a new, removed, or
  // renamed `rendersCardTypes`) without changing any card — the module-level
  // cache would otherwise hide that until a full page reload. Drop the cache and
  // re-resolve on any view-source change, and on reconnect: file-change events
  // are transient and not replayed, so an edit during a dropped socket would
  // otherwise leave the binding stale (same resync the sibling views do).
  const connectedOnceRef = useRef(false);
  useBusSubscription({
    onEvent: useCallback((event: RealtimeEvent) => {
      const change = busEventData(event, "file-change");
      if (!change || viewSlugFromSourcePath(change.path) === null) return;
      invalidateBindings();
      load();
    }, [load]),
    onConnect: useCallback(() => {
      if (!connectedOnceRef.current) {
        connectedOnceRef.current = true;
        return;
      }
      invalidateBindings();
      load();
    }, [load]),
  });

  return binding;
}
