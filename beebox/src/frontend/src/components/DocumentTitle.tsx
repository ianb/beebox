/**
 * The single writer of `document.title`.
 *
 * Titling used to be a convention — call `useDocumentTitle` in your page —
 * and eighteen of nineteen pages forgot, so every tab read `Bee Box`.
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
import { useRouterState } from "@tanstack/react-router";
import { composeDocumentTitle } from "../lib/document-title";
import { useBoxName } from "../hooks/useBoxName";

interface PageTitleWriters {
  publish: (owner: object, title: string) => void;
  clear: (owner: object) => void;
  publishMark: (owner: object, mark: string) => void;
  clearMark: (owner: object) => void;
  setWorking: (owner: object, working: boolean) => void;
}

interface PageTitleValues {
  /** A page's own name for itself, overriding its route's static title. */
  title: string | null;
  /** The current landmark's emoji, led with in the composed title. */
  mark: string | null;
  /** Whether anything on the page is working — see `useWorking`. */
  working: boolean;
}

const PageTitleReadContext = createContext<PageTitleValues>({ title: null, mark: null, working: false });
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
 * Publish the current landmark's emoji, which leads the title.
 *
 * A separate slot from `usePageTitle` on purpose: the place you are in and the
 * name of what you are looking at are different facts, published by different
 * components, and sharing one slot would make them race for it.
 */
export function usePlaceMark(mark: string | null | undefined): void {
  const writers = useContext(PageTitleWriteContext);
  const ownerRef = useRef<object>({});
  const value = mark?.trim() || null;

  useEffect(() => {
    const owner = ownerRef.current;
    if (writers === null) return;
    if (value === null) writers.clearMark(owner);
    else writers.publishMark(owner, value);
    return () => { writers.clearMark(owner); };
  }, [writers, value]);
}

/**
 * Say that something on this page is working, which shows in the tab.
 *
 * ANY caller saying so is enough: this counts owners rather than keeping the
 * last value, so two components working at once don't cancel each other when
 * the first finishes. Today the only caller is the chat, while a turn is
 * streaming — but the whole point of the shape is that the tab does not need
 * to know what kind of work it is.
 *
 * **Presence is the signal, not the animation.** The glyph appears while
 * something is working and vanishes when nothing is, which is a fact a browser
 * cannot throttle away. The spin is decoration on top: a hidden tab throttles
 * timers to about once a second, and Chrome slows them much further after a
 * few minutes hidden — so an animation is exactly what stops being trustworthy
 * in a long-running background turn, which is the case this exists to serve.
 * Built the other way round — animation carrying the meaning — a frozen
 * spinner would read as "stuck" at the precise moment the honest answer is
 * "still going".
 */
export function useWorking(working: boolean): void {
  const writers = useContext(PageTitleWriteContext);
  const ownerRef = useRef<object>({});

  useEffect(() => {
    const owner = ownerRef.current;
    if (writers === null) return;
    writers.setWorking(owner, working);
    return () => { writers.setWorking(owner, false); };
  }, [writers, working]);
}

/**
 * Provides the publication channel and mounts the writer. Rendered by
 * `RootLayout` around the whole route tree, with `children` passed through so
 * a publication re-renders only this provider and the writer — never the
 * routed page (see the file header).
 */
export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [published, setPublished] = useState<{ owner: object; title: string } | null>(null);
  const [mark, setMark] = useState<{ owner: object; mark: string } | null>(null);
  // A SET of owners, not a boolean: "anyone working" is the question, and the
  // first of two workers to finish must not answer it for the other.
  const [workingOwners, setWorkingOwners] = useState<ReadonlySet<object>>(() => new Set());
  // Nested inside another provider (the error page mounts its own, and cannot
  // know whether the root layout survived the error), this is a pass-through:
  // two providers would mean two writers racing to set `document.title`.
  const enclosing = useContext(PageTitleWriteContext);

  const writers = useMemo<PageTitleWriters>(
    () => ({
      publish: (owner, title) => setPublished({ owner, title }),
      clear: (owner) => setPublished((cur) => (cur !== null && cur.owner === owner ? null : cur)),
      publishMark: (owner, glyph) => setMark({ owner, mark: glyph }),
      clearMark: (owner) => setMark((cur) => (cur !== null && cur.owner === owner ? null : cur)),
      setWorking: (owner, working) => setWorkingOwners((cur) => {
        if (cur.has(owner) === working) return cur;
        const next = new Set(cur);
        if (working) next.add(owner);
        else next.delete(owner);
        return next;
      }),
    }),
    [],
  );

  const values = useMemo<PageTitleValues>(
    () => ({ title: published?.title ?? null, mark: mark?.mark ?? null, working: workingOwners.size > 0 }),
    [published, mark, workingOwners],
  );

  if (enclosing !== null) return children;

  return (
    <PageTitleWriteContext.Provider value={writers}>
      <PageTitleReadContext.Provider value={values}>
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
  const { title: published, mark, working } = useContext(PageTitleReadContext);
  const spinner = useSpinnerFrame(working);

  // Selecting the string rather than the matches array keeps this a primitive
  // comparison, so an unrelated router state change doesn't re-render.
  const routeTitle = useRouterState({
    select: (state) => {
      const leaf = state.matches[state.matches.length - 1];
      return leaf?.staticData.title ?? null;
    },
  });

  // `useBoxName` falls back to the slug while the box list loads, which keeps
  // the title from flashing the app name on a cold load, and to "" outside a
  // box -- which composes as absent.
  const { boxName } = useBoxName();

  // Working displaces the landmark's mark rather than crowding in beside it:
  // one glyph's worth of room, and while something is running that is the more
  // urgent of the two. The place is still named in the title's text.
  const title = composeDocumentTitle({ mark: spinner ?? mark, page: published ?? routeTitle, box: boxName });

  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}

/** Frames of the working glyph, in order. */
const SPINNER_FRAMES = ["\u25D0", "\u25D3", "\u25D1", "\u25D2"];
const SPINNER_INTERVAL_MS = 400;

/**
 * The current working glyph, or null when nothing is working.
 *
 * The interval only exists while something is working, so an idle tab runs no
 * timer at all. A hidden tab will animate slowly or barely — see `useWorking`
 * for why that costs nothing: the glyph's presence is the message.
 */
function useSpinnerFrame(working: boolean): string | null {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => { setFrame((f) => f + 1); }, SPINNER_INTERVAL_MS);
    return () => { window.clearInterval(timer); };
  }, [working]);

  if (!working) return null;
  return SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0] ?? null;
}
