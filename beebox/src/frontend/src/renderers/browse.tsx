import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
import { useEffect, useRef, useState } from "react";
import { registerFileType, type RendererProps } from "./index";
import { SystemCardBoundary } from "../components/system-cards/SystemCardBoundary";
import { BrowseBody } from "../pages/browse/BrowsePage";
import { BrowseLocationError } from "../pages/browse/components/BrowseLocationError";
import { browseParent, browseStateToViewState, legacyBrowseTarget, parseBrowseState, type BrowseMissingKind, type BrowseState } from "../lib/browse-card-state";
import { trpc } from "../lib/trpc";
import { type ViewState, type ViewTarget } from "../lib/view-url";
import { BrowseLoading } from "../pages/browse/components/BrowseLoading";
import { useAppBarPlace } from "../components/app-bar-chrome";
import { useCardVisible } from "../components/chat/everywhere/card-context";
import { useWorkspace } from "../components/chat/workspace/WorkspaceProvider";

function browseLocationValid({
  directoryKind,
  hasDetail,
  detailKind,
}: {
  directoryKind: "directory" | "file" | "missing" | undefined;
  hasDetail: boolean;
  detailKind: "directory" | "file" | "missing" | undefined;
}): boolean {
  if (hasDetail) return detailKind === "file" || detailKind === "missing";
  return directoryKind === "directory";
}

function browseLocationLoading({ hasDetail, directoryLoading, detailLoading }: {
  hasDetail: boolean;
  directoryLoading: boolean;
  detailLoading: boolean;
}): boolean {
  return hasDetail ? detailLoading : directoryLoading;
}

function BrowseLocation({ state, onChange }: { state: BrowseState; onChange: (next: ViewState, method: "push" | "replace") => void }) {
  const visible = useCardVisible();
  const workspace = useWorkspace();
  const focused = workspace?.activeView?.target.path === SYSTEM_CARD_PATHS.browse;
  const utils = trpc.useUtils();
  const navigationVersion = useRef(0);
  const stateKey = JSON.stringify(state);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const directory = trpc.files.kind.useQuery({ path: state.directory });
  const detail = trpc.files.kind.useQuery({ path: state.detail?.path ?? "" }, { enabled: Boolean(state.detail) });
  const valid = browseLocationValid({
    directoryKind: directory.data?.kind,
    hasDetail: state.detail !== undefined,
    detailKind: detail.data?.kind,
  });
  useAppBarPlace(visible && focused && valid ? { dir: state.directory, label: state.directory ? `Browse: ${state.directory}` : "Browse" } : null);
  useEffect(() => {
    setNavigationError(null);
    return () => { navigationVersion.current += 1; };
  }, [stateKey]);
  async function navigate({ target, method, missingKind }: {
    target: ViewTarget;
    method: "push" | "replace";
    missingKind: BrowseMissingKind;
  }) {
    const version = ++navigationVersion.current;
    setNavigationError(null);
    try {
      const next = await legacyBrowseTarget(target, {
        lookupKind: async (path) => (await utils.files.kind.fetch({ path })).kind,
        missingKind,
      });
      if (version !== navigationVersion.current) return;
      if (next.viewState) onChange(next.viewState, method);
    } catch (error) {
      if (version !== navigationVersion.current) return;
      setNavigationError(error instanceof Error ? error.message : "Could not open Browse location.");
    }
  }
  const reset = () => { navigationVersion.current += 1; onChange({ directory: "" }, "replace"); };
  if (browseLocationLoading({
    hasDetail: state.detail !== undefined,
    directoryLoading: directory.isLoading,
    detailLoading: state.detail !== undefined && detail.isLoading,
  })) return <BrowseLoading />;
  if (!valid) return <BrowseLocationError error={`Cannot browse ${state.detail?.path ?? (state.directory || "/")}: ${directory.error?.message ?? detail.error?.message ?? "expected an existing directory and a file detail"}`} onRoot={reset} onRetry={() => { void directory.refetch(); if (state.detail) void detail.refetch(); }} />;
  return <>
    {navigationError ? <BrowseLocationError error={navigationError} onRoot={reset} /> : null}
    <BrowseBody state={state} onNavigate={(path, options) => { void navigate({
      target: { path, viewer: null, params: {}, viewState: null },
      method: options.replace ? "replace" : "push",
      missingKind: options.kind,
    }); }}
      onDetailNavigate={(target, method) => {
        if (state.detail?.path === target.path && browseParent(target.path) === state.directory) { navigationVersion.current += 1; onChange(browseStateToViewState({ ...state, detail: target }), method); }
        else void navigate({ target, method, missingKind: "file" });
      }} />
  </>;
}

function BrowseCardBody({ viewState, params, onViewStateChange }: RendererProps) {
  const parsed = parseBrowseState({ viewState, params });
  const onChange = (next: ViewState, method: "push" | "replace") => onViewStateChange?.(next, method);
  if (!parsed.ok) return <BrowseLocationError error={parsed.error} onRoot={() => onChange({ directory: "" }, "replace")} />;
  return <BrowseLocation state={parsed.state} onChange={onChange} />;
}

function BrowseCard(props: RendererProps) {
  return <SystemCardBoundary path={props.data.path} type="browse"><BrowseCardBody {...props} /></SystemCardBoundary>;
}
registerFileType({ type: "browse" }, { renderer: { name: "Browse", Component: BrowseCard, priority: 100 } });
