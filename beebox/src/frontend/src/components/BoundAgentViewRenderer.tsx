import { useCallback, useState, type ReactNode } from "react";
import type { ActivityKind } from "@core/chat/card-activity.js";
import type { NavigateHint, ViewState, ViewTarget } from "../lib/view-url";
import { AgentViewRenderer } from "./AgentViewRenderer";

export interface BoundAgentViewRendererProps {
  slug: string;
  mode: "page" | "chat";
  path: string;
  params?: Record<string, string>;
  ownedViewState?: ViewState | null;
  canPushViewState?: boolean;
  onViewStateChange?: (next: ViewState, method: "push" | "replace") => void;
  reportActivity?: (kind: ActivityKind, detail?: string) => void;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  renderInline: (target: ViewTarget) => ReactNode;
}

/** Stable component boundary around a replaceable authored-view module. */
export function BoundAgentViewRenderer(props: BoundAgentViewRendererProps) {
  const { slug, mode, path, params, ownedViewState, canPushViewState, onViewStateChange, reportActivity, onNavigate, renderInline } = props;
  const ownedStateKey = JSON.stringify(ownedViewState ?? {});
  const [localState, setLocalState] = useState<{ path: string; ownedStateKey: string; state: ViewState } | null>(null);
  const state = localState?.path === path && localState.ownedStateKey === ownedStateKey
    ? localState.state
    : ownedViewState;
  const handleChange = useCallback((next: ViewState, method: "push" | "replace") => {
    if (onViewStateChange) onViewStateChange(next, method);
    else setLocalState({ path, ownedStateKey, state: next });
  }, [onViewStateChange, ownedStateKey, path]);
  return (
    <AgentViewRenderer
      slug={slug}
      mode={mode}
      params={{ ...params, path }}
      viewState={state}
      canPushViewState={canPushViewState}
      onViewStateChange={handleChange}
      {...(reportActivity !== undefined ? { reportActivity } : {})}
      onNavigate={onNavigate}
      renderInline={renderInline}
    />
  );
}
