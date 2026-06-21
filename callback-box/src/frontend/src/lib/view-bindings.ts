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

import { useEffect, useState } from "react";
import { getApiBase } from "../api";

export interface CardViewBinding {
  slug: string;
  name: string;
}

interface ViewMetaLite {
  slug: string;
  name: string;
  rendersCardTypes?: string[];
}

let bindingsPromise: Promise<Map<string, CardViewBinding>> | null = null;

function fetchBindings(): Promise<Map<string, CardViewBinding>> {
  bindingsPromise ??= (async () => {
    const map = new Map<string, CardViewBinding>();
    try {
      const resp = await fetch(`${getApiBase()}/views`);
      if (!resp.ok) return map;
      const metas = await resp.json() as ViewMetaLite[];
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

/** The custom view bound to a card type, or null (also null while loading). */
export function useCardViewBinding(type: string | undefined): CardViewBinding | null {
  const [binding, setBinding] = useState<CardViewBinding | null>(null);
  useEffect(() => {
    if (type === undefined) {
      setBinding(null);
      return;
    }
    let cancelled = false;
    void fetchBindings().then((map) => {
      if (!cancelled) setBinding(map.get(type) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [type]);
  return binding;
}
