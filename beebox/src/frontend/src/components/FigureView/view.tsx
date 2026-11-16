/**
 * Figure card renderer — compiles the card's `entry` source and mounts the
 * resulting sketch through the per-runtime harness (FigureMount).
 *
 * The card's `entry` (e.g. `attach/sketch.ts`) is resolved against the card
 * path, compiled by `/api/figure/module.js`, and dynamically imported. Compile
 * errors arrive as a `figureError` export (with `figureOutdated` when a
 * canvas-loop type error names a removed call); runtime/mount errors are
 * caught by the harness and surfaced through this component's notice state
 * (the React error boundary is only a backstop for synchronous render throws).
 * Every state — loading, a notice, the mounted figure — goes in one slot
 * inside `FigureLayout`, so the description and caption always show.
 */

import { useCardActivityReporter } from "../../lib/activity/scope";
import { errorMessage } from "@shared/error-guards";
import { isRecord } from "@shared/is-record";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getApiBase } from "../../api";
import { resolveRelativePath } from "../../lib/view-url";
import { useViewFileHelpers } from "../../hooks/useViewFileHelpers";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { fileChangeAt } from "../../lib/live-refresh";
import { coerceFigureParams, parseDeclaredParams } from "../../lib/figure-params";
import { figureNotice, type FigureNotice as NoticeInfo } from "../../lib/figure-canvas-loop";
import { ViewErrorBoundary } from "../ViewErrorBoundary";
import { Markdown } from "../Markdown/body";
import type { RendererProps } from "../../file-type-registry";
import { StatusMessage } from "../ui/StatusMessage";
import {
  FigureMount,
  figureFileHelpers,
  type FigureContext,
  type FigureRuntime,
  type FigureSketch,
} from "./FigureMount";
import { FigureLayout, FigureNotice } from "./FigureLayout";

interface FigureModule {
  default?: FigureSketch;
  figureError?: string;
  /** The removed call a canvas-loop type error names: the sketch was written for the earlier canvas-loop. */
  figureOutdated?: string;
}

function parseRuntime(value: unknown): FigureRuntime | null {
  return value === "p5js" || value === "three" || value === "d3" || value === "canvas-loop" ? value : null;
}

/** The notice for a module the route compiled: a compile or type error, or none. */
function moduleNotice(imported: FigureModule): NoticeInfo | null {
  if (imported.figureOutdated !== undefined) return { kind: "outdated", detail: imported.figureOutdated };
  return imported.figureError === undefined ? null : { kind: "error", detail: imported.figureError };
}

export function FigureView({ data, onNavigate, params, mode, caption }: RendererProps) {
  const apiBase = getApiBase();
  const frontmatter = useMemo(() => data.frontmatter ?? {}, [data.frontmatter]);
  const runtime = parseRuntime(frontmatter.runtime);
  const entry = typeof frontmatter.entry === "string" ? frontmatter.entry : "";
  // An `entry` that escapes the box root resolves to null; collapsing it to ""
  // routes it into the existing "missing a valid `entry`" error state below —
  // the figure shows an error instead of compiling some other file.
  const entryPath = entry === "" ? "" : resolveRelativePath(data.path, entry) ?? "";

  // Coerce embed query params against the card's declared `params` contract.
  // Recomputed each render (pure + cheap); a param change reshapes `figure` and
  // remounts the sketch via the FigureMount key below.
  const declared = parseDeclaredParams(frontmatter.params);
  const figureParams = coerceFigureParams(declared, params ?? {});
  const paramsKey = JSON.stringify(figureParams);

  const [mod, setMod] = useState<FigureModule | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeInfo | null>(null);
  // One console warning per outdated figure, with the card path: it reaches
  // the box's client debug log, where the agent can find it.
  const showNotice = useCallback((next: NoticeInfo | null) => {
    if (next?.kind === "outdated") console.warn(`figure ${data.path}: needs regenerating: ${next.detail}`);
    setNotice(next);
  }, [data.path]);
  const onFigureError = useCallback((error: unknown) => { showNotice(figureNotice(error)); }, [showNotice]);
  // Cache-bust suffix for re-imports; bumped per (re)load. Starts at 0 — the
  // first loadModule() writes a real timestamp (Date.now() in render is barred
  // by react-hooks purity).
  const versionRef = useRef(0);

  const loadModule = useCallback(async () => {
    if (entryPath === "") {
      showNotice({ kind: "error", detail: "Figure card is missing a valid `entry` source pointer" });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      versionRef.current = Date.now();
      const url = `${apiBase}/figure/module.js?path=${encodeURIComponent(entryPath)}&v=${versionRef.current}`;
      // eslint-disable-next-line no-restricted-syntax -- dynamic import of a box-compiled, agent-authored figure module; there is no static type for arbitrary runtime-loaded JS, so this boundary cast is unavoidable.
      const imported = await import(/* @vite-ignore */ url) as FigureModule;
      setMod(imported);
      showNotice(moduleNotice(imported));
    } catch (e) {
      showNotice(figureNotice(errorMessage(e)));
    } finally {
      setLoading(false);
    }
  }, [apiBase, entryPath, showNotice]);

  useEffect(() => {
    void loadModule();
  }, [loadModule]);

  // Live reload: recompile when the entry source changes on disk, or on a reconnect.
  useLiveRefresh({ when: fileChangeAt(entryPath), refresh: () => { void loadModule(); } });

  const fileHelpers = useViewFileHelpers(apiBase);
  const report = useCardActivityReporter(data.path);
  // Built inline (not memoized): FigureMount reads it via a ref and remounts on
  // `paramsKey`, so a fresh object identity each render is harmless — and it
  // avoids a stale-deps disable.
  const figure: FigureContext = {
    params: figureParams,
    data: isRecord(frontmatter.data) ? frontmatter.data : {},
    meta: frontmatter,
    file: figureFileHelpers(fileHelpers),
  };

  const sketch = mod?.default;
  let slot: ReactNode;
  if (runtime === null) {
    slot = <FigureNotice notice={{ kind: "error", detail: `Unknown figure runtime: ${String(frontmatter.runtime)}` }} />;
  } else if (notice !== null) {
    slot = <FigureNotice notice={notice} />;
  } else if (loading || mod === null) {
    slot = <StatusMessage busy className="p-4">Loading figure…</StatusMessage>;
  } else if (typeof sketch !== "function") {
    slot = <FigureNotice notice={{ kind: "error", detail: "Figure source has no default-exported sketch" }} />;
  } else {
    slot = (
      <ViewErrorBoundary onRetry={() => void loadModule()}>
        <FigureMount key={paramsKey} runtime={runtime} sketch={sketch} figure={figure} onError={onFigureError} declaredParams={declared}
          report={report} />
      </ViewErrorBoundary>
    );
  }

  const description = typeof data.body === "string" ? data.body : "";
  return (
    <FigureLayout
      mode={mode}
      caption={caption}
      description={description.trim() !== "" ? <Markdown prose="block" onNavigate={onNavigate} basePath={data.path}>{description}</Markdown> : null}
    >
      {slot}
    </FigureLayout>
  );
}
