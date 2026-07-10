/**
 * Core renderer for agent-generated views.
 *
 * Dynamically imports the compiled view module, fetches matching cards,
 * and subscribes to SSE for live updates.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { getApiBase } from "../api";
import type { ActivityKind } from "../../../core/chat/card-activity.js";
import { useBusSubscription, type RealtimeEvent } from "../hooks/useBusSubscription";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
import { Pre } from "./ui/Pre";
import { useViewFileHelpers, type ViewFile, type ViewFileHelpers } from "../hooks/useViewFileHelpers";
import { trpc } from "../lib/trpc";
import {
  ViewHostProvider,
  useViewHost,
  makeOpenCard,
  refToTarget,
  type ViewHost,
  type ResolvedRef,
} from "../lib/view-host";
import { type NavigateHint, type ViewTarget } from "../lib/view-url";
// Side effect: installs window.__cbViewWidgets so the compiler's
// `callback-box/view-widgets` shim can hand CardLink/CardRef to compiled views.
import "./view-widgets";
/** View card data from the API */
interface ViewCard {
  path: string;
  /** Card type, from the filename (`Foo.<type>.card`). */
  type: string;
  /** Frontmatter fields (body and type excluded). */
  frontmatter?: Record<string, unknown>;
  /** Markdown body. */
  body?: string;
  /** Files in this card's attach scope (deep), box-relative, with size/mtime. */
  attachments?: ViewFile[];
}

/** Props passed to every view component */
interface ViewProps extends ViewFileHelpers {
  cards: ViewCard[];
  files: ViewFile[];
  navigate: (path: string) => void;
  boxSlug: string;
  params: Record<string, string>;
  /**
   * Report user activity on this card to the chat's companion-pane accumulator,
   * with an optional free-text detail surfaced as the `<card-activity>` element text (e.g. the query
   * the user typed). Writes auto-report `"modified"` with the path; a view that
   * changes parameters without changing data should call
   * `reportActivity("explored", "<what they're looking at>")`. A no-op outside
   * the companion pane (inline/page renders don't accumulate).
   */
  reportActivity: (kind: ActivityKind, detail?: string) => void;
}

/**
 * Wrap the file helpers so a successful write/append/commit reports
 * `"modified"` with the path. Only the companion-pane AgentViewRenderer passes a
 * real reporter, so inline/page views can write freely without polluting the
 * accumulator.
 */
function withModifiedReporting(
  helpers: ViewFileHelpers,
  report: (kind: ActivityKind, detail?: string) => void,
): ViewFileHelpers {
  return {
    ...helpers,
    writeFile: async (path, opts) => { const r = await helpers.writeFile(path, opts); report("modified", path); return r; },
    appendFile: async (path, opts) => { const r = await helpers.appendFile(path, opts); report("modified", path); return r; },
    commitFile: async (path, message) => { const r = await helpers.commitFile(path, message); report("modified", path); return r; },
  };
}

type ViewMode = "page" | "chat";


// Expose React globally so agent-generated views can use it
// via the esbuild shim that references window.__cbReact
declare global {
  interface Window {
    __cbReact?: typeof React;
  }
}

// Guarded for SSR: `cb render` (src/ssr/setup.ts) keeps `window` undefined
// during module import — a bare `window.__cbReact` here crashed every SSR route
// that transitively imports this file. Mirrors the guard on `__cbViewWidgets`
// (view-widgets/index.tsx). In the browser window is always present; under SSR
// the install is skipped (effects don't run, so no compiled view reads it).
if (typeof window !== "undefined" && !window.__cbReact) {
  window.__cbReact = React;
}

interface AgentViewRendererProps {
  slug: string;
  mode: ViewMode;
  /** Query parameters passed to the view component and cards API. */
  params?: Record<string, string>;
  /** Companion-pane activity reporter; omitted for inline/page renders. */
  reportActivity?: (kind: ActivityKind, detail?: string) => void;
  /**
   * The surface's "open a card here" primitive — companion → onZoomView,
   * browse → swap the detail pane, page → push a route. Lifted into the view
   * host so card widgets (`<CardLink>`/`<CardRef>`) open cards surface-correctly.
   * Required: every mount (card-attached page/chat/companion) supplies it.
   */
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  /**
   * Render a card expanded in place — backs `<CardRef>`'s expand-inline. Injected
   * by the mount site (which owns FileView) so AgentAgentViewRenderer never imports
   * FileView (that would form a value-import cycle). Omitted → expand is a no-op.
   */
  renderInline?: (cardPath: string) => ReactNode;
}

/**
 * Browser implementation of the host's `useResolvedRef` capability: title/type/
 * existence via the `views.resolveRef` tRPC query, resolved against the view's
 * basePath (read from the host so this stays a bare named-hook reference the
 * widget can call). Node `cb view test` supplies its own filename-derived
 * version — the widget consumes whichever through context.
 */
function useBrowserResolvedRef(cardRef: string): ResolvedRef | null {
  const { basePath } = useViewHost();
  const { data } = trpc.views.resolveRef.useQuery({ ref: cardRef, basePath });
  return data ?? null;
}

/**
 * Assemble the browser {@link ViewHost} the card widgets consume. `basePath`
 * (the rendered card's path for a card-bound view, else the box root) anchors
 * relative refs; `onNavigate` is the surface's open-a-card primitive.
 */
function buildViewHost(args: {
  boxSlug: string | undefined;
  basePath: string;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  renderInline?: (cardPath: string) => ReactNode;
}): ViewHost {
  const { boxSlug, basePath, onNavigate, renderInline } = args;
  return {
    openCard: makeOpenCard(onNavigate, basePath),
    useResolvedRef: useBrowserResolvedRef,
    renderInline: (cardRef) => (renderInline ? renderInline(refToTarget(cardRef, basePath).path) : null),
    basePath,
    boxSlug: boxSlug || "",
  };
}

interface ViewModule {
  default: React.ComponentType<ViewProps>;
  name?: string;
  description?: string;
  dependencies?: string[];
  modes?: ViewMode[];
}

export function AgentViewRenderer({ slug: rawSlug, mode, params, reportActivity, onNavigate, renderInline }: AgentViewRendererProps) {
  // Guard: strip any query string that leaked into the slug
  const qIdx = rawSlug.indexOf("?");
  const slug = qIdx !== -1 ? rawSlug.slice(0, qIdx) : rawSlug;
  const viewParams = params || {};
  const { boxSlug } = useParams({ strict: false });
  const navigate = useNavigate();
  const [mod, setMod] = useState<ViewModule | null>(null);
  const [cards, setCards] = useState<ViewCard[]>([]);
  const [files, setFiles] = useState<ViewFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Cache-bust suffix for re-imports — set on first load and bumped per
  // reload. Initial value is 0; the first `loadModule()` writes a real
  // timestamp. Was `useRef(Date.now())` but the react-hooks/purity rule
  // (rightly) flags Date.now() in render.
  const versionRef = useRef(0);
  // Bumped on every module (re)load so ViewErrorBoundary can release a latched
  // error — a runtime-throwing view that the box then fixes recovers on its own
  // reload instead of staying stuck until a manual Retry.
  const [reloadSeq, setReloadSeq] = useState(0);

  const apiBase = getApiBase();

  const loadModule = useCallback(async () => {
    try {
      versionRef.current = Date.now();
      const imported = await import(
        /* @vite-ignore */ `${apiBase}/views/${slug}/module.js?v=${versionRef.current}`
      ) as ViewModule;
      setMod(imported);
      setError(null);
      // Bump *after* the new module is in so the boundary's reset and the
      // fixed component land in the same render — bumping before the await
      // would reset against the still-broken module and immediately re-throw.
      setReloadSeq((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiBase, slug]);

  const paramsString = JSON.stringify(viewParams);
  const loadCards = useCallback(async () => {
    try {
      const qs = new URLSearchParams(viewParams).toString();
      const url = qs ? `${apiBase}/views/${slug}/cards?${qs}` : `${apiBase}/views/${slug}/cards`;
      const resp = await fetch(url);
      if (!resp.ok) {
        setError(`Failed to load cards: ${resp.status}`);
        return;
      }
      const data = await resp.json() as { cards: ViewCard[]; files: ViewFile[] };
      setCards(data.cards);
      setFiles(data.files);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, slug, paramsString]);

  // Initial load. setLoading(true) is intentionally synchronous here so
  // the spinner shows before the awaits resolve; the trailing
  // setLoading(false) lands after Promise.all settles.

  useEffect(() => {
    setLoading(true);
    // Both loadModule/loadCards catch their own errors into `error` state, so
    // this can't actually reject -- but if something unexpected did throw,
    // failing to clear `loading` here would leave the spinner stuck forever.
    Promise.all([loadModule(), loadCards()])
      .then(() => {
        setLoading(false);
      })
      .catch((e: unknown) => {
        console.error("[AgentViewRenderer] unexpected load failure:", e);
        setLoading(false);
      });
  }, [loadModule, loadCards]);


  // Subscribe to the box event stream for live updates
  const connectedOnceRef = useRef(false);
  useBusSubscription({
    onEvent: useCallback((event: RealtimeEvent) => {
      if (event.event === "file-change") {
        const data = event.data as { path?: string };
        const changedPath = data.path || "";
        // View source changed — reload module
        if (changedPath === `views/${slug}.tsx`) {
          void loadModule();
        }
        // Card changed — reload data. Non-card files reload too when they
        // sit under a dependency glob's static prefix (e.g. an attach-scope
        // .jsonl the view renders).
        const depPrefixes = (mod?.dependencies ?? [])
          .map((d) => d.split("*")[0] ?? "")
          .filter((prefix) => prefix !== "");
        if (changedPath.endsWith(".card") || depPrefixes.some((prefix) => changedPath.startsWith(prefix))) {
          void loadCards();
        }
      }
    }, [slug, loadModule, loadCards, mod]),
    // Resync on a *re*connect: file-change events are transient and not replayed,
    // so a card edited while the socket was dropped would otherwise leave the
    // view stale. Skip the initial connect — the mount effect already loads.
    onConnect: useCallback(() => {
      if (!connectedOnceRef.current) {
        connectedOnceRef.current = true;
        return;
      }
      void loadCards();
    }, [loadCards]),
  });

  const fileHelpers = useViewFileHelpers(apiBase);
  const report = useCallback((kind: ActivityKind, detail?: string) => { reportActivity?.(kind, detail); }, [reportActivity]);
  const activityHelpers = useMemo(() => withModifiedReporting(fileHelpers, report), [fileHelpers, report]);

  const viewNavigate = useCallback((path: string) => {
    if (boxSlug) {
      // navigate()'s promise only rejects on a superseded/redirected
      // navigation (not a user-facing failure) -- fire-and-forget.
      void navigate({ to: `/${boxSlug}/${path}` });
    }
  }, [boxSlug, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-gray-500">
        Loading view...
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-danger-light bg-danger-50 rounded-lg p-4">
        <h3 className="text-danger-dark font-medium mb-2">View Error</h3>
        <Pre size="sm" error>{error}</Pre>
      </div>
    );
  }

  if (!mod) {
    return (
      <div className="text-gray-500 p-4">View not found: {slug}</div>
    );
  }

  const Component = mod.default;
  const containerClass = mode === "chat"
    ? "max-h-96 overflow-auto border rounded-lg p-3"
    : "w-full";

  // The view host the card widgets (CardLink/CardRef) consume.
  const viewHost = buildViewHost({
    boxSlug,
    basePath: Object.hasOwn(viewParams, "path") ? viewParams.path : "",
    onNavigate,
    renderInline,
  });

  return (
    <div className={containerClass}>
      <ViewErrorBoundary onRetry={() => void loadModule()} resetKey={reloadSeq}>
        <ViewHostProvider value={viewHost}>
          <Component
            cards={cards}
            files={files}
            {...activityHelpers}
            navigate={viewNavigate}
            boxSlug={boxSlug || ""}
            params={viewParams}
            reportActivity={report}
          />
        </ViewHostProvider>
      </ViewErrorBoundary>
    </div>
  );
}
