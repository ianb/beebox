/**
 * The single writer of `document.title`.
 *
 * Titling used to be a convention — call `useDocumentTitle` in your page —
 * and eighteen of nineteen pages forgot, so every tab read `Callback Box`.
 * It is now structural in two halves:
 *
 *  1. **Every route declares a title.** `StaticDataRouteOption` is augmented
 *     in `router.tsx` with a required `title`, which makes TanStack Router's
 *     `staticData` mandatory on every `createRoute` call. Route twenty does
 *     not typecheck until it says what it is called. A route that genuinely
 *     names nothing (a layout, a redirect) says so with `title: null`.
 *  2. **A page may publish a better one.** A chat's label or a card's title
 *     beats the route's static "Chat"/"Card", and only the mounted component
 *     knows it. `usePageTitle` publishes it; the route's static title is the
 *     fallback that shows while it loads (and forever, if it never arrives).
 *
 * Composition — `<page> — <box>`, no app name — lives in
 * `lib/document-title.ts`. Nothing else in the app writes `document.title`.
 *
 * The old `useDocumentTitle` hook saved and restored the previous title
 * around its own mount, which made "previous" ambiguous once more than one
 * page used it and could reinstate a stale title mid-navigation. There is no
 * save/restore here: one writer, recomputing from the current route.
 *
 * Render stability follows `app-bar-chrome.tsx`: pages consume only the write
 * context (whose functions are `[]`-stable), `children` passes straight
 * through the provider so a publication can't re-render the routed page, and
 * publications carry an owner token so an unmounting page's cleanup — which
 * React may run *after* the incoming page's effects — clears the title only
 * if it still owns it.
 */

import {
  createContext, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { useParams, useRouterState } from "@tanstack/react-router";
import { composeDocumentTitle } from "../lib/document-title";
import { useBoxes } from "../hooks/useBoxes";

interface PageTitleWriters {
  publish: (owner: object, title: string) => void;
  clear: (owner: object) => void;
}

const PageTitleReadContext = createContext<string | null>(null);
const PageTitleWriteContext = createContext<PageTitleWriters | null>(null);

/**
 * Publish this page's own title, overriding its route's static one. Pass null
 * (typical while the naming data loads) to fall back to the route's.
 */
export function usePageTitle(title: string | null | undefined): void {
  const writers = useContext(PageTitleWriteContext);
  const ownerRef = useRef<object>({});
  const value = title?.trim() || null;

  useEffect(() => {
    const owner = ownerRef.current;
    if (writers === null) return;
    if (value === null) writers.clear(owner);
    else writers.publish(owner, value);
    // Owner-scoped: a stale unmount must not erase a newer page's title.
    return () => { writers.clear(owner); };
  }, [writers, value]);
}

/**
 * Provides the publication channel and mounts the writer. Rendered by
 * `RootLayout` around the whole route tree, with `children` passed through so
 * a publication re-renders only this provider and the writer — never the
 * routed page (see the file header).
 */
export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [published, setPublished] = useState<{ owner: object; title: string } | null>(null);

  const writers = useMemo<PageTitleWriters>(
    () => ({
      publish: (owner, title) => setPublished({ owner, title }),
      clear: (owner) => setPublished((cur) => (cur !== null && cur.owner === owner ? null : cur)),
    }),
    [],
  );

  return (
    <PageTitleWriteContext.Provider value={writers}>
      <PageTitleReadContext.Provider value={published === null ? null : published.title}>
        <DocumentTitleWriter />
        {children}
      </PageTitleReadContext.Provider>
    </PageTitleWriteContext.Provider>
  );
}

/**
 * Recomputes `document.title` from the leaf route, the published override,
 * and the current box. Renders nothing.
 */
function DocumentTitleWriter() {
  const published = useContext(PageTitleReadContext);

  // Selecting the string rather than the matches array keeps this a primitive
  // comparison, so an unrelated router state change doesn't re-render.
  const routeTitle = useRouterState({
    select: (state) => {
      const leaf = state.matches[state.matches.length - 1];
      return leaf?.staticData.title ?? null;
    },
  });

  const { boxSlug } = useParams({ strict: false });
  const { boxes } = useBoxes();
  // The slug stands in until the box list resolves. Without it the title
  // would flash the app name — "Settings — Callback Box" — on every cold
  // load before settling on the box's real name.
  const box = boxes.find((b) => b.slug === boxSlug)?.name ?? boxSlug ?? null;

  const title = composeDocumentTitle({ page: published ?? routeTitle, box });

  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}
