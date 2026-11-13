/**
 * Core renderer for agent-generated views.
 *
 * Dynamically imports the compiled view module, fetches matching cards,
 * and subscribes to SSE for live updates.
 */

import { errorMessage } from "@shared/error-guards";
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import * as ReactDOM from "react-dom";
import { useNavigate, useParams } from "@tanstack/react-router";
import { getApiBase } from "../../api";
import type { ReportActivity } from "@core/chat/card-activity.js";
import { usePaneCard, useActivityLogger } from "../../lib/activity/scope";
import type { RealtimeEvent } from "../../hooks/useBusSubscription";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { ViewErrorBoundary } from "../ViewErrorBoundary";
import { Pre } from "../ui/Pre";
import { useViewFileHelpers, type ViewFile, type ViewFileHelpers } from "../../hooks/useViewFileHelpers";
import { trpc } from "../../lib/trpc/client";
import { busEventData } from "../../lib/bus-events";
import { RequestError } from "../../lib/errors";
import { createFetchCoalescer } from "../../lib/fetch-coalescer";
import {
  ViewHostProvider,
  useViewHost,
  makeOpenCard,
  refToTarget,
  type ViewHost,
  type ResolvedRef,
  type RenderInline,
} from "../../lib/view-host";
import { type NavigateHint, type ViewTarget } from "../../lib/view-url";
import { viewSlugFromSourcePath } from "../../lib/view-source-path";
import { type ViewState } from "../../lib/view-url";
import type { ViewHistory, ViewLayout } from "@core/views/types.js";
import { useViewHistory } from "../../hooks/useViewHistory";
import { StatusMessage } from "../ui/StatusMessage";
// Side effect: installs window.__bbxViewWidgets so the compiler's
// `beebox/view-widgets` shim can hand CardLink/CardRef/Markdown to compiled views.
import "../view-widgets/window-globals";
import { Notice } from "../ui/Notice";
/** View card data from the API */
interface ViewCard {
  path: string;
  /** Card type, from the filename (`Foo.<type>.card`). */
  type: string;
  /** Frontmatter fields (body and type excluded). */
  frontmatter?: Record<string, unknown>;
  /** Markdown body. */
  body?: string;
  /** File lines before the body; `Markdown` takes it with `path`. */
  bodyLineOffset: number;
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
  viewHistory: ViewHistory;
  /**
   * Report user activity on this card to the chat's companion-pane accumulator,
   * with an optional free-text detail surfaced as the `<card-activity>` element text (e.g. the query
   * the user typed). Writes auto-report `"modified"` with the path; a view that
   * changes parameters without changing data should call
   * `reportActivity("explored", "<what they're looking at>")`. A no-op outside
   * the companion pane (inline/page renders don't accumulate).
   */
  reportActivity: ReportActivity;
  /** `"strip"` when drawn in the conversation strip, else `"page"`. */
  mode: "page" | "strip";
}

/**
 * Wrap the file helpers so a successful write/append/commit reports
 * `"modified"` with the path. Only the companion-pane AgentViewRenderer passes a
 * real reporter, so inline/page views can write freely without polluting the
 * accumulator.
 */
function withModifiedReporting(
  helpers: ViewFileHelpers,
  report: ReportActivity,
): ViewFileHelpers {
  return {
    ...helpers,
    writeFile: async (path, opts) => { const r = await helpers.writeFile(path, opts); report("modified", path); return r; },
    appendFile: async (path, opts) => { const r = await helpers.appendFile(path, opts); report("modified", path); return r; },
    commitFile: async (path, message) => { const r = await helpers.commitFile(path, message); report("modified", path); return r; },
  };
}

// Expose React and react-dom globally so agent-generated views can use them
// via the esbuild shims that reference window.__bbxReact and
// window.__bbxReactDOM (src/webapp/views/compiler/compile.ts). A view that
// bundles a plugin view (`beebox/plugins/<name>/view`) carries React Flow,
// whose portals need the host's react-dom, not a second copy.
declare global {
  interface Window {
    __bbxReact?: typeof React;
    __bbxReactDOM?: typeof ReactDOM;
  }
}

// Guarded because this runs at module-eval time: a bare `window.__bbxReact` here
// crashed on import under a non-browser evaluation (it took down the since-
// removed `bbx render`). No such consumer exists today, but the guard is one
// cheap line and re-arming the landmine costs an incident — anything that ever
// imports this file outside a browser (a component test, a static emitter)
// hits it again. Mirrors the guard on `__bbxViewWidgets` (view-widgets/index.tsx).
if (typeof window !== "undefined" && !window.__bbxReact) {
  window.__bbxReact = React;
}
if (typeof window !== "undefined" && !window.__bbxReactDOM) {
  window.__bbxReactDOM = ReactDOM;
}

interface AgentViewRendererProps {
  slug: string;
  /**
   * Rendered inside another card's body (a `view:` embed), whose content
   * area already supplies the inset — so the view's own layout is not applied.
   */
  embedded: boolean;
  /** The surface mode the view receives as its `mode` prop. */
  viewMode: "page" | "strip";
  /** Query parameters passed to the view component and cards API. */
  params?: Record<string, string>;
  viewState?: ViewState | null;
  canPushViewState?: boolean;
  onViewStateChange?: (next: ViewState, method: "push" | "replace") => void;
  /** Companion-pane activity reporter; omitted for inline/page renders. */
  reportActivity?: ReportActivity;
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
  renderInline?: RenderInline<ViewTarget>;
}

/**
 * Browser implementation of the host's `useResolvedRef` capability: title/type/
 * existence via the `views.resolveRef` tRPC query, resolved against the view's
 * basePath (read from the host so this stays a bare named-hook reference the
 * widget can call). Node `bbx view check` supplies its own filename-derived
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
  renderInline?: RenderInline<ViewTarget>;
}): ViewHost {
  const { boxSlug, basePath, onNavigate, renderInline } = args;
  return {
    openCard: makeOpenCard(onNavigate, basePath),
    useResolvedRef: useBrowserResolvedRef,
    renderInline: (cardRef, opts) => {
      const target = refToTarget(cardRef, basePath);
      // A box-escaping ref has no file to inline; the chip that owns this
      // expansion already shows its own `missing` badge (the resolver reports
      // exists:false for escapes), so rendering nothing here isn't silent.
      if (target === null || renderInline === undefined) return null;
      return renderInline(target, opts);
    },
    basePath,
    boxSlug: boxSlug || "",
  };
}

interface ViewModule {
  default: React.ComponentType<ViewProps>;
  name?: string;
  description?: string;
  dependencies?: string[];
  layout?: ViewLayout;
}

interface CardsPayload {
  cards: ViewCard[];
  files: ViewFile[];
}

/**
 * Module-level cards-fetch coalescer, keyed by the FULL request URL
 * (including `apiBase` — a box-specific origin, so two boxes' identical
 * `slug`+`qs` must never share a key; an SPA navigation that swaps boxes
 * while box A's request is still in flight must not hand box B's renderer
 * A's cards). Every bound card visible in a chat mounts its own
 * `AgentViewRenderer`, each with its own bus subscription — on a WS
 * reconnect, every instance resyncs in the same tick, and
 * without this, each issued its own bare `fetch` (56 identical
 * `/api/views/:slug/cards` GETs in one second, observed on prod).
 *
 * `refetch()` (used by the file-change and reconnect handlers below) is what
 * makes that safe for a real edit: joining an in-flight fetch on those
 * triggers risked applying a snapshot taken *before* the edit; `refetch()`
 * instead schedules exactly one trailing fetch after the in-flight one
 * settles. See `fetch-coalescer.ts`.
 */
const cardsFetchCache = createFetchCoalescer<CardsPayload>();

async function fetchCardsJson(url: string): Promise<CardsPayload> {
  const resp = await fetch(url);
  if (!resp.ok) {
    const message = `Failed to load cards: ${resp.status}`;
    throw new RequestError(message);
  }
  const data: CardsPayload = await resp.json();
  return data;
}

export function AgentViewRenderer({ slug: rawSlug, embedded, viewMode, params, viewState, canPushViewState: canPushArg, onViewStateChange, reportActivity, onNavigate, renderInline }: AgentViewRendererProps) {
  // Guard: strip any query string that leaked into the slug
  const qIdx = rawSlug.indexOf("?");
  const slug = qIdx !== -1 ? rawSlug.slice(0, qIdx) : rawSlug;
  const canPushViewState = canPushArg ?? false;
  const viewParams = params || {};
  const { boxSlug } = useParams({ strict: false });
  const navigate = useNavigate();
  // Each result records the slug it was loaded for. The view mounts once both
  // match the current slug; a params change then refetches cards behind the
  // mounted view, which keeps its React state and its scroll position. The
  // view gets the params its cards were loaded for, so new params never arrive
  // with the old params' cards.
  const [loadedModule, setLoadedModule] = useState<{ slug: string; mod: ViewModule } | null>(null);
  const [loadedCards, setLoadedCards] = useState<{ slug: string; params: Record<string, string>; cards: ViewCard[]; files: ViewFile[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mod = loadedModule?.slug === slug ? loadedModule.mod : null;
  // The newest cards request; a slower response for older params is dropped.
  const latestCardsUrl = useRef("");
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
      // eslint-disable-next-line no-restricted-syntax -- dynamic import of a box-compiled, agent-authored view module; there is no static type for arbitrary runtime-loaded JS, so this boundary cast is unavoidable.
      const imported = await import(
        /* @vite-ignore */ `${apiBase}/views/${slug}/module.js?v=${versionRef.current}`
      ) as ViewModule;
      setLoadedModule({ slug, mod: imported });
      setError(null);
      // Bump *after* the new module is in so the boundary's reset and the
      // fixed component land in the same render — bumping before the await
      // would reset against the still-broken module and immediately re-throw.
      setReloadSeq((n) => n + 1);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [apiBase, slug]);

  const paramsString = JSON.stringify(viewParams);
  const loadCards = useCallback(async (opts?: { refetch?: boolean }) => {
    let url = "";
    try {
      const qs = new URLSearchParams(viewParams).toString();
      url = qs ? `${apiBase}/views/${slug}/cards?${qs}` : `${apiBase}/views/${slug}/cards`;
      latestCardsUrl.current = url;
      const data = opts?.refetch
        ? await cardsFetchCache.refetch(url, () => fetchCardsJson(url))
        : await cardsFetchCache.load(url, () => fetchCardsJson(url));
      if (latestCardsUrl.current !== url) return;
      setLoadedCards({ slug, params: viewParams, cards: data.cards, files: data.files });
    } catch (e) {
      if (latestCardsUrl.current === url) setError(errorMessage(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, slug, paramsString]);

  // Both loaders catch their own errors into `error`. The module reloads only
  // for a new slug; new params refetch only the cards.
  useEffect(() => { void loadModule(); }, [loadModule]);
  useEffect(() => { void loadCards(); }, [loadCards]);


  // Live updates from the box event stream. Cards reload through
  // `useLiveRefresh`: N mounted instances of this view (one per bound card
  // visible in chat) coalesce, a hidden tab waits until shown, and a reconnect
  // resyncs (file-change events are not replayed). `refetch: true`: the event
  // IS the "the data just changed" signal, so a fetch already in flight must
  // not be trusted to already reflect it.
  //
  // A change to the view's own source reloads the module at once, from the
  // same subscription: `when` sees every event, and a module reload is not a
  // card refresh.
  const refreshCards = useCallback(() => { void loadCards({ refetch: true }); }, [loadCards]);
  const cardsChanged = useCallback((event: RealtimeEvent) => {
    const fileChange = busEventData(event, "file-change");
    if (!fileChange) return false;
    const changedPath = fileChange.path;
    if (viewSlugFromSourcePath(changedPath) === slug) {
      void loadModule();
    }
    // Non-card files count when they sit under a dependency glob's static
    // prefix (e.g. an attach-scope .jsonl the view renders).
    const depPrefixes = (mod?.dependencies ?? [])
      .map((d) => d.split("*")[0] ?? "")
      .filter((prefix) => prefix !== "");
    return changedPath.endsWith(".card") || depPrefixes.some((prefix) => changedPath.startsWith(prefix));
  }, [slug, loadModule, mod]);
  useLiveRefresh({ when: cardsChanged, refresh: refreshCards });

  const fileHelpers = useViewFileHelpers(apiBase);
  // The view's reporter keeps the latest-wins snapshot and, in the companion
  // pane, logs every call except `scrolled` (the pane logs that itself).
  const paneCard = usePaneCard();
  const logActivity = useActivityLogger();
  const report = useCallback<ReportActivity>((...[kind, detail, activity]) => {
    if (reportActivity === undefined) return;
    reportActivity(kind, detail, activity);
    if (paneCard === null || kind === "scrolled") return;
    logActivity({ card: paneCard, kind, ...(detail !== undefined ? { detail } : {}), ...(activity !== undefined ? { activity } : {}) });
  }, [reportActivity, paneCard, logActivity]);
  const activityHelpers = useMemo(() => withModifiedReporting(fileHelpers, report), [fileHelpers, report]);

  const viewHistory = useViewHistory({ slug, state: viewState, canPush: canPushViewState, onChange: onViewStateChange });

  const viewNavigate = useCallback((path: string) => {
    if (boxSlug) {
      // navigate()'s promise only rejects on a superseded/redirected
      // navigation (not a user-facing failure) -- fire-and-forget.
      void navigate({ to: `/${boxSlug}/${path}` });
    }
  }, [boxSlug, navigate]);

  if (error) {
    return (
      <Notice tone="error">
        <h3 className="font-medium mb-2">View Error</h3>
        <Pre size="sm" error>{error}</Pre>
      </Notice>
    );
  }

  if (!mod || loadedCards?.slug !== slug) {
    return (
      <StatusMessage busy className="flex items-center justify-center">
        Loading view…
      </StatusMessage>
    );
  }
  const { params: loadedParams, cards, files } = loadedCards;

  const Component = mod.default;
  // The card surface owns chat-mode height and scrolling; this applies only
  // the view's inset. An unrecognized `layout` export falls back to "inset";
  // view metadata validation is what reports it.
  const layout: ViewLayout = embedded || mod.layout === "full-bleed" ? "full-bleed" : "inset";

  // The view host the card widgets (CardLink/CardRef) consume.
  const viewHost = buildViewHost({
    boxSlug,
    basePath: loadedParams.path ?? "",
    onNavigate,
    renderInline,
  });

  return (
    <div className="bbx-card-view" data-view-layout={layout} data-view-embedded={embedded || undefined}>
      <ViewErrorBoundary onRetry={() => void loadModule()} resetKey={reloadSeq}>
        <ViewHostProvider value={viewHost}>
          <Component
            cards={cards}
            files={files}
            {...activityHelpers}
            navigate={viewNavigate}
            boxSlug={boxSlug || ""}
            params={loadedParams}
            viewHistory={viewHistory}
            reportActivity={report}
            mode={viewMode}
          />
        </ViewHostProvider>
      </ViewErrorBoundary>
    </div>
  );
}
