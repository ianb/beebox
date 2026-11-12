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
import { trpcClient } from "./trpc/client";
import { busEventData } from "./bus-events";
import { viewSlugFromSourcePath } from "./view-source-path";
import { stripViewFor } from "@shared/strip-types";
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

/** The views listing, sorted by slug; both binding rules read it. */
interface ViewListingEntry extends CardViewBinding {
  modes: readonly string[];
  rendersCardTypes: readonly string[];
}

const bindingsCache = createSingleFlightCache<ViewListingEntry[]>(async () => {
  try {
    const metas = await trpcClient.views.list.query();
    return metas
      .map((meta) => ({ slug: meta.slug, name: meta.name, modes: meta.modes, rendersCardTypes: meta.rendersCardTypes }))
      .toSorted((a, b) => a.slug.localeCompare(b.slug));
  } catch (e) {
    // No views listing (older server, network hiccup): cards simply fall
    // back to the built-in renderers. Log so a real outage is visible.
    console.warn("view-bindings: could not load views listing", e);
    return [];
  }
});

function fetchBindings(): Promise<ViewListingEntry[]> {
  return bindingsCache.load();
}

/** Drop the memoized bindings so the next `fetchBindings()` re-reads `/api/views`. */
function invalidateBindings(): void {
  bindingsCache.invalidate();
}

/** The page binding rule: the first view by slug that renders the type. */
function pageViewFor(views: readonly ViewListingEntry[], type: string): ViewListingEntry | null {
  return views.find((view) => view.rendersCardTypes.includes(type)) ?? null;
}

function toBinding(view: ViewListingEntry | null): CardViewBinding | null {
  return view === null ? null : { slug: view.slug, name: view.name };
}

/** The custom view bound to a card type, or null (also null while loading). */
export function useCardViewBinding(type: string | undefined): CardViewBinding | null {
  return useViewBinding(type, pageViewFor);
}

/**
 * The box view that draws a card type in the conversation strip, or null
 * (also null while loading). `stripViewFor` is the rule the server's
 * `bbx chat strip set` applies, so an accepted card has a view here.
 */
export function useStripViewBinding(type: string | undefined): CardViewBinding | null {
  return useViewBinding(type, stripViewFor);
}

function useViewBinding(
  type: string | undefined,
  pick: (views: readonly ViewListingEntry[], type: string) => ViewListingEntry | null,
): CardViewBinding | null {
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
    void fetchBindings().then((views) => {
      if (mountedRef.current && req === reqRef.current) setBinding(toBinding(pick(views, type)));
    });
  }, [type, pick]);

  useEffect(() => load(), [load]);

  // A view edit can change which view renders a card type (a new, removed, or
  // renamed `rendersCardTypes`) without changing any card — the module-level
  // cache would otherwise hide that until a full page reload. Drop the cache and
  // re-resolve on any view-source change, and on reconnect: file-change events
  // are transient and not replayed, so an edit during a dropped socket would
  // otherwise leave the binding stale (same resync the sibling views do).
  useBusSubscription({
    onEvent: useCallback((event: RealtimeEvent) => {
      const change = busEventData(event, "file-change");
      if (!change || viewSlugFromSourcePath(change.path) === null) return;
      invalidateBindings();
      load();
    }, [load]),
    onReconnect: useCallback(() => {
      invalidateBindings();
      load();
    }, [load]),
  });

  return binding;
}
