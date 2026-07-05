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
import { useBusSubscription, type RealtimeEvent } from "../hooks/useBusSubscription";

export interface CardViewBinding {
  slug: string;
  name: string;
}

let bindingsPromise: Promise<Map<string, CardViewBinding>> | null = null;

function fetchBindings(): Promise<Map<string, CardViewBinding>> {
  bindingsPromise ??= (async () => {
    const map = new Map<string, CardViewBinding>();
    try {
      const metas = await trpcClient.views.list.query();
      for (const meta of [...metas].toSorted((a, b) => a.slug.localeCompare(b.slug))) {
        for (const type of meta.rendersCardTypes ?? []) {
          if (!map.has(type)) map.set(type, { slug: meta.slug, name: meta.name });
        }
      }
    } catch (e) {
      // No views listing (older server, network hiccup): cards simply fall
      // back to the built-in renderers. Log so a real outage is visible.
      console.warn("view-bindings: could not load views listing", e);
    }
    return map;
  })();
  return bindingsPromise;
}

/**
 * Drop the memoized bindings so the next fetch re-reads `/api/views`. Coalesced
 * across the many FileViews mounted at once (chat embeds whole conversations):
 * the first call in a tick clears the cache, the rest no-op until the microtask
 * resets the guard, so a single view edit triggers one refetch — not one per
 * mounted card, each clobbering the previous in-flight fetch.
 */
let invalidating = false;
function invalidateBindings(): void {
  if (invalidating) return;
  invalidating = true;
  bindingsPromise = null;
  queueMicrotask(() => { invalidating = false; });
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
      if (event.event !== "file-change") return;
      const data = event.data as { path?: string };
      if (typeof data.path !== "string" || !/^views\/.+\.tsx$/.test(data.path)) return;
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
