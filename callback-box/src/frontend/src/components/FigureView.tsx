/**
 * Figure card renderer — compiles the card's `entry` source and mounts the
 * resulting sketch through the per-runtime harness (FigureMount).
 *
 * The card's `entry` (e.g. `attach/sketch.ts`) is resolved against the card
 * path, compiled by `/api/figure/module.js`, and dynamically imported. Compile
 * errors arrive as a `figureError` export; runtime/mount errors are caught by
 * the harness and surfaced through this component's error state (the React
 * error boundary is only a backstop for synchronous render throws).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBase } from "../api";
import { resolveRelativePath } from "../lib/view-url";
import { useViewFileHelpers } from "../hooks/useViewFileHelpers";
import { useBusSubscription, type RealtimeEvent } from "../hooks/useBusSubscription";
import { coerceFigureParams, parseDeclaredParams } from "../lib/figure-params";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
import { Markdown } from "./Markdown";
import { Pre } from "./ui/Pre";
import type { RendererProps } from "../renderers/index";
import {
  FigureMount,
  type FigureContext,
  type FigureRuntime,
  type FigureSketch,
} from "./FigureMount";

interface FigureModule {
  default?: FigureSketch;
  figureError?: string;
}

function parseRuntime(value: unknown): FigureRuntime | null {
  return value === "p5js" || value === "three" || value === "d3" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function FigureView({ data, onNavigate, params, mode }: RendererProps) {
  const apiBase = getApiBase();
  const frontmatter = useMemo(() => data.frontmatter ?? {}, [data.frontmatter]);
  const runtime = parseRuntime(frontmatter.runtime);
  const entry = typeof frontmatter.entry === "string" ? frontmatter.entry : "";
  const entryPath = entry === "" ? "" : resolveRelativePath(data.path, entry);

  // Coerce embed query params against the card's declared `params` contract.
  // Recomputed each render (pure + cheap); a param change reshapes `figure` and
  // remounts the sketch via the FigureMount key below.
  const declared = parseDeclaredParams(frontmatter.params);
  const figureParams = coerceFigureParams(declared, params ?? {});
  const paramsKey = JSON.stringify(figureParams);

  const [mod, setMod] = useState<FigureModule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Cache-bust suffix for re-imports; bumped per (re)load. Starts at 0 — the
  // first loadModule() writes a real timestamp (Date.now() in render is barred
  // by react-hooks purity).
  const versionRef = useRef(0);

  const loadModule = useCallback(async () => {
    if (entryPath === "") {
      setError("Figure card is missing a valid `entry` source pointer");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      versionRef.current = Date.now();
      const url = `${apiBase}/figure/module.js?path=${encodeURIComponent(entryPath)}&v=${versionRef.current}`;
      const imported = await import(/* @vite-ignore */ url) as FigureModule;
      setMod(imported);
      setError(imported.figureError ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [apiBase, entryPath]);

  useEffect(() => {
    void loadModule();
  }, [loadModule]);

  // Live reload: recompile when the entry source changes on disk.
  useBusSubscription({
    onEvent: useCallback((event: RealtimeEvent) => {
      if (event.event !== "file-change") return;
      const changed = (event.data as { path?: string }).path ?? "";
      if (changed === entryPath) void loadModule();
    }, [entryPath, loadModule]),
  });

  const fileHelpers = useViewFileHelpers(apiBase);
  // Built inline (not memoized): FigureMount reads it via a ref and remounts on
  // `paramsKey`, so a fresh object identity each render is harmless — and it
  // avoids a stale-deps disable.
  const figure: FigureContext = {
    params: figureParams,
    data: isRecord(frontmatter.data) ? frontmatter.data : {},
    meta: frontmatter,
    file: fileHelpers,
  };

  if (runtime === null) {
    return <FigureError message={`Unknown figure runtime: ${String(frontmatter.runtime)}`} />;
  }
  if (error !== null) {
    return <FigureError message={error} />;
  }
  if (loading || mod === null) {
    return <div className="p-4 text-warm-600">Loading figure…</div>;
  }
  const sketch = mod.default;
  if (typeof sketch !== "function") {
    return <FigureError message="Figure source has no default-exported sketch" />;
  }

  const figureEl = (
    <ViewErrorBoundary onRetry={loadModule}>
      <FigureMount key={paramsKey} runtime={runtime} sketch={sketch} figure={figure} onError={setError} />
    </ViewErrorBoundary>
  );

  // Embedded (chat/companion): just the interactive — minimal chrome. On the
  // full page, show the card's description below it. (FileView's page header
  // already offers the Source toggle.)
  if (mode === "page") {
    const description = typeof data.body === "string" ? data.body : "";
    return (
      <div className="p-4">
        {figureEl}
        {description.trim() !== "" ? (
          <div className="mt-3 max-w-2xl text-warm-700">
            <Markdown prose="block" onNavigate={onNavigate} basePath={data.path}>{description}</Markdown>
          </div>
        ) : null}
      </div>
    );
  }
  return figureEl;
}

function FigureError({ message }: { message: string }) {
  return (
    <div className="border border-danger-light bg-danger-50 rounded-lg p-4">
      <h3 className="text-danger-dark font-medium mb-2">Figure error</h3>
      <Pre size="sm" error>{message}</Pre>
    </div>
  );
}
