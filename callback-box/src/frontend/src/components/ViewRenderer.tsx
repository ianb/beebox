/**
 * Core renderer for agent-generated views.
 *
 * Dynamically imports the compiled view module, fetches matching cards,
 * and subscribes to SSE for live updates.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { getApiBase, getEventSourceBase } from "../api";
import { useSSE, type SSEEvent } from "../hooks/useSSE";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
/** View card data from the API */
interface ViewCard {
  path: string;
  tagName: string;
  attrs: Record<string, string>;
  text?: string;
  children?: ViewCardChild[];
  status?: string;
}

interface ViewCardChild {
  tagName: string;
  attrs: Record<string, string>;
  text?: string;
  children?: ViewCardChild[];
}

/** Props passed to every view component */
interface ViewProps {
  cards: ViewCard[];
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

export function ViewRenderer({ slug, mode, params }: ViewRendererProps) {
  const viewParams = params || {};
  const { boxSlug } = useParams({ strict: false });
  const navigate = useNavigate();
  const [mod, setMod] = useState<ViewModule | null>(null);
  const [cards, setCards] = useState<ViewCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const versionRef = useRef(Date.now());

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
  const loadCards = useCallback(async () => {
    try {
      const qs = new URLSearchParams(viewParams).toString();
      const url = qs ? `${apiBase}/views/${slug}/cards?${qs}` : `${apiBase}/views/${slug}/cards`;
      const resp = await fetch(url);
      if (!resp.ok) {
        setError(`Failed to load cards: ${resp.status}`);
        return;
      }
      const data = await resp.json() as ViewCard[];
      setCards(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, slug, paramsString]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    Promise.all([loadModule(), loadCards()]).then(() => {
      setLoading(false);
    });
  }, [loadModule, loadCards]);

  // Subscribe to SSE for live updates
  useSSE(`${getEventSourceBase()}/events`, {
    onEvent: useCallback((event: SSEEvent) => {
      if (event.event === "file-change") {
        const data = event.data as { path?: string };
        const changedPath = data.path || "";
        // View source changed — reload module
        if (changedPath === `views/${slug}.tsx`) {
          loadModule();
        }
        // Card changed — reload cards
        if (changedPath.endsWith(".card")) {
          loadCards();
        }
      }
    }, [slug, loadModule, loadCards]),
  });

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
      <div className="border border-red-300 bg-red-50 rounded-lg p-4">
        <h3 className="text-red-800 font-medium mb-2">View Error</h3>
        <pre className="text-sm text-red-700 whitespace-pre-wrap">{error}</pre>
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
          navigate={viewNavigate}
          boxSlug={boxSlug || ""}
          params={viewParams}
        />
      </ViewErrorBoundary>
      {mode === "chat" && Boolean(boxSlug) && (
        <div className="mt-2 text-right">
          <a
            href={`/${boxSlug}/views/${slug}${paramsString !== "{}" ? "?" + new URLSearchParams(viewParams).toString() : ""}`}
            className="text-sm text-blue-600 hover:text-blue-800"
            onClick={(e) => {
              e.preventDefault();
              const qs = new URLSearchParams(viewParams).toString();
              navigate({ to: `/${boxSlug}/views/${slug}${qs ? "?" + qs : ""}` });
            }}
          >
            Open full page &rarr;
          </a>
        </div>
      )}
    </div>
  );
}
