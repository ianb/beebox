import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
import { useEffect, useRef, useState } from "react";
import { registerFileType, type RendererProps } from "./index";
import { SystemCardBoundary } from "../components/system-cards/SystemCardBoundary";
import { BrowseBody } from "../pages/browse/BrowsePage";
import { BrowseLocationError } from "../pages/browse/components/BrowseLocationError";
import { browseParent, browseStateToViewState, legacyBrowseTarget, parseBrowseState, type BrowseState } from "../lib/browse-card-state";
import { trpc } from "../lib/trpc";
import { parseViewUrl, type ViewState, type ViewTarget } from "../lib/view-url";
import { BrowseLoading } from "../pages/browse/components/BrowseLoading";
import { useAppBarPlace } from "../components/app-bar-chrome";
import { useCardVisible, useFocusedConversationCard } from "../components/chat/everywhere/card-context";

function BrowseLocation({ state, onChange }: { state: BrowseState; onChange: (next: ViewState, method: "push" | "replace") => void }) {
  const visible = useCardVisible();
  const focusedCard = useFocusedConversationCard();
  const focused = focusedCard !== null && parseViewUrl(focusedCard).path === SYSTEM_CARD_PATHS.browse;
  const utils = trpc.useUtils();
  const navigationVersion = useRef(0);
  const stateKey = JSON.stringify(state);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const directory = trpc.files.kind.useQuery({ path: state.directory });
  const detail = trpc.files.kind.useQuery({ path: state.detail?.path ?? "" }, { enabled: Boolean(state.detail) });
  const valid = directory.data?.kind === "directory" && (!state.detail || detail.data?.kind === "file");
  useAppBarPlace(visible && focused && valid ? { dir: state.directory, label: state.directory ? `Browse: ${state.directory}` : "Browse" } : null);
  useEffect(() => {
    setNavigationError(null);
    return () => { navigationVersion.current += 1; };
  }, [stateKey]);
  async function navigate(target: ViewTarget, method: "push" | "replace") {
    const version = ++navigationVersion.current;
    setNavigationError(null);
    try {
      const next = await legacyBrowseTarget(target, async (path) => (await utils.files.kind.fetch({ path })).kind);
      if (version !== navigationVersion.current) return;
      if (next.viewState) onChange(next.viewState, method);
    } catch (error) {
      if (version !== navigationVersion.current) return;
      setNavigationError(error instanceof Error ? error.message : "Could not open Browse location.");
    }
  }
  const reset = () => { navigationVersion.current += 1; onChange({ directory: "" }, "replace"); };
  if (directory.isLoading || (state.detail && detail.isLoading)) return <BrowseLoading />;
  if (!valid) return <BrowseLocationError error={`Cannot browse ${state.detail?.path ?? (state.directory || "/")}: ${directory.error?.message ?? detail.error?.message ?? "expected an existing directory and a file detail"}`} onRoot={reset} onRetry={() => { void directory.refetch(); if (state.detail) void detail.refetch(); }} />;
  return <>
    {navigationError ? <BrowseLocationError error={navigationError} onRoot={reset} /> : null}
    <BrowseBody state={state} onNavigate={(path, options) => { void navigate({ path, viewer: null, params: {}, viewState: null }, options?.replace ? "replace" : "push"); }}
      onDetailNavigate={(target, method) => {
        if (state.detail?.path === target.path && browseParent(target.path) === state.directory) { navigationVersion.current += 1; onChange(browseStateToViewState({ ...state, detail: target }), method); }
        else void navigate(target, method);
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
