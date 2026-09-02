import type { ReactNode } from "react";
import type { ActivityKind } from "@core/chat/card-activity.js";
import type { FileData, FileRenderer } from "../renderers";
import type { NavigateHint, ViewState, ViewTarget } from "../lib/view-url";
import type { FileViewMode } from "./file-view-types";
import { BoundAgentViewRenderer } from "./BoundAgentViewRenderer";

interface ActiveFileRendererProps {
  active: FileRenderer;
  binding: { name: string; slug: string } | null;
  data: FileData;
  path: string;
  mode: FileViewMode;
  params?: Record<string, string>;
  viewState?: ViewState | null;
  canPushViewState?: boolean;
  onViewStateChange?: (next: ViewState, method: "push" | "replace") => void;
  reportActivity?: (kind: ActivityKind, detail?: string) => void;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  renderInline: (target: ViewTarget) => ReactNode;
  caption?: string;
}

export function ActiveFileRenderer(props: ActiveFileRendererProps) {
  const { active, binding, data, path, mode, params, viewState, canPushViewState, onViewStateChange, reportActivity, onNavigate, renderInline, caption } = props;
  if (binding !== null && active.name === binding.name) {
    return (
      <BoundAgentViewRenderer
        slug={binding.slug}
        mode={mode === "chat" ? "chat" : "page"}
        path={path}
        params={params}
        ownedViewState={viewState}
        canPushViewState={canPushViewState}
        {...(onViewStateChange !== undefined ? { onViewStateChange } : {})}
        {...(reportActivity !== undefined ? { reportActivity } : {})}
        onNavigate={onNavigate}
        renderInline={renderInline}
      />
    );
  }
  return <active.Component data={data} onNavigate={onNavigate} params={params} mode={mode} caption={caption} />;
}

/** Registry marker; FileView renders the stable bound renderer directly. */
export function AuthoredRendererMarker(): null {
  return null;
}
