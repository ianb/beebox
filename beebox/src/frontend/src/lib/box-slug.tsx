/**
 * The box slug a rendering sits under, as a context rather than a router read.
 *
 * `Markdown` needs the slug to build link and image URLs. Reading it with the
 * router's `useParams` tied `Markdown` to the app router, so it could not
 * render in `bbx view test` (Node, `react-dom/server`, no router). The app's
 * root layout provides the slug from the route; the node view host
 * (`view-widgets/node-entry.tsx`) provides the node host's slug.
 *
 * `undefined` is a real value: an app page outside `/$boxSlug` (login, setup)
 * has no box. A missing provider is a bug and throws.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";

const BoxSlugContext = createContext<{ boxSlug: string | undefined } | null>(null);

/** Thrown when a slug consumer renders with no {@link BoxSlugProvider} above it. */
class BoxSlugMissingError extends Error {
  constructor() {
    super("useBoxSlug() called outside a <BoxSlugProvider> — the app root layout and the node view host provide one.");
    this.name = "BoxSlugMissingError";
  }
}

export function BoxSlugProvider({ boxSlug, children }: { boxSlug: string | undefined; children: ReactNode }) {
  const value = useMemo(() => ({ boxSlug }), [boxSlug]);
  return <BoxSlugContext.Provider value={value}>{children}</BoxSlugContext.Provider>;
}

/** The surrounding box slug; `undefined` outside a box route. Throws without a provider. */
export function useBoxSlug(): string | undefined {
  const value = useContext(BoxSlugContext);
  if (value === null) throw new BoxSlugMissingError();
  return value.boxSlug;
}
