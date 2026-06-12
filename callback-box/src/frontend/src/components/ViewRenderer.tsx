/**
 * Core renderer for agent-generated views.
 *
 * Dynamically imports the compiled view module, fetches matching cards,
 * and subscribes to SSE for live updates.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { getApiBase, withBase } from "../api";
import { useBusSubscription, type RealtimeEvent } from "../hooks/useBusSubscription";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
import { Pre } from "./ui/Pre";
import { useViewFileHelpers, type ViewFile, type ViewFileHelpers } from "../hooks/useViewFileHelpers";
/** View card data from the API */
interface ViewCard {
  path: string;
  tagName: string;
  attrs: Record<string, string>;
  text?: string;
  children?: ViewCardChild[];
  status?: string;
  /** Files in this card's attach scope (deep), box-relative, with size/mtime. */
  attachments?: ViewFile[];
}



interface ViewCardChild {
  tagName: string;
  attrs: Record<string, string>;
  text?: string;
  children?: ViewCardChild[];
}

/** Props passed to every view component */
interface ViewProps extends ViewFileHelpers {
  cards: ViewCard[];
  files: ViewFile[];
  navigate: (path: string) => void;
  boxSlug: string;
  params: Record<string, string>;
}

type ViewMode = "page" | "chat";


// Expose React globally so agent-generated views can use it
// via the esbuild shim that references window.__cbReact
declare global {
  interface Window {
    __cbReact?: typeof React;
  }
}

if (!window.__cbReact) {
  window.__cbReact = React;
}

interface ViewRendererProps {
  slug: string;
  mode: ViewMode;
  /** Query parameters passed to the view component and cards API. */
  params?: Record<string, string>;
}

interface ViewModule {
  default: React.ComponentType<ViewProps>;
  name?: string;
  description?: string;
  dependencies?: string[];
  modes?: ViewMode[];
}

export function ViewRenderer({ slug: rawSlug, mode, params }: ViewRendererProps) {
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

  const apiBase = getApiBase();

  const loadModule = useCallback(async () => {
    try {
      versionRef.current = Date.now();
      const imported = await import(
        /* @vite-ignore */ `${apiBase}/views/${slug}/module.js?v=${versionRef.current}`
      ) as ViewModule;
      setMod(imported);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiBase, slug]);

  const paramsString = JSON.stringify(viewParams);
  const fullPageQs = new URLSearchParams(viewParams).toString();
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
    Promise.all([loadModule(), loadCards()]).then(() => {
      setLoading(false);
    });
  }, [loadModule, loadCards]);


  // Subscribe to the box event stream for live updates
  useBusSubscription({
    onEvent: useCallback((event: RealtimeEvent) => {
      if (event.event === "file-change") {
        const data = event.data as { path?: string };
        const changedPath = data.path || "";
        // View source changed — reload module
        if (changedPath === `views/${slug}.tsx`) {
          loadModule();
        }
        // Card changed — reload data. Non-card files reload too when they
        // sit under a dependency glob's static prefix (e.g. an attach-scope
        // .jsonl the view renders).
        const depPrefixes = (mod?.dependencies ?? [])
          .map((d) => d.split("*")[0] ?? "")
          .filter((prefix) => prefix !== "");
        if (changedPath.endsWith(".card") || depPrefixes.some((prefix) => changedPath.startsWith(prefix))) {
          loadCards();
        }
      }
    }, [slug, loadModule, loadCards, mod]),
  });

  const fileHelpers = useViewFileHelpers(apiBase);

  const viewNavigate = useCallback((path: string) => {
    if (boxSlug) {
      navigate({ to: `/${boxSlug}/${path}` });
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

  return (
    <div className={containerClass}>
      <ViewErrorBoundary onRetry={loadModule}>
        <Component
          cards={cards}
          files={files}
          {...fileHelpers}
          navigate={viewNavigate}
          boxSlug={boxSlug || ""}
          params={viewParams}
        />
      </ViewErrorBoundary>
      {mode === "chat" && Boolean(boxSlug) && (
        <div className="mt-2 text-right">
          <a
            href={withBase(`/${boxSlug}/views/${slug}${fullPageQs ? "?" + fullPageQs : ""}`)}
            className="text-sm text-blue-600 hover:text-blue-800"
            onClick={(e) => {
              e.preventDefault();
              navigate({ to: `/${boxSlug}/views/${slug}${fullPageQs ? "?" + fullPageQs : ""}` });
            }}
          >
            Open full page &rarr;
          </a>
        </div>
      )}
    </div>
  );
}
