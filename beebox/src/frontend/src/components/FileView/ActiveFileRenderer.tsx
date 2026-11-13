import { useState } from "react";
import type { FileData, FileRenderer } from "../../file-type-registry";
import type { RenderInline } from "../../lib/view-host";
import type { NavigateHint, ViewState, ViewTarget } from "../../lib/view-url";
import { isFrameless, type FileViewMode } from "../file-view-types";
import { BoundAgentViewRenderer } from "./BoundAgentViewRenderer";
import { CaptionedFigure } from "../FigureView/view";

interface ActiveFileRendererProps {
  active: FileRenderer;
  binding: { name: string; slug: string } | null;
  data: FileData;
  path: string;
  mode: FileViewMode;
  workspacePdf?: boolean;
  params?: Record<string, string>;
  viewState?: ViewState | null;
  canPushViewState?: boolean;
  onViewStateChange?: (next: ViewState, method: "push" | "replace") => void;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  renderInline: RenderInline<ViewTarget>;
  caption?: string;
}

export function ActiveFileRenderer(props: ActiveFileRendererProps) {
  const { active, binding, data, path, mode, params, viewState, canPushViewState, onViewStateChange, onNavigate, renderInline, caption } = props;
  const stateKey = JSON.stringify(viewState ?? null);
  const [local, setLocal] = useState<{ path: string; stateKey: string; state: ViewState } | null>(null);
  const builtinState = local?.path === path && local.stateKey === stateKey ? local.state : viewState;
  function handleBuiltinState(next: ViewState, method: "push" | "replace") {
    if (onViewStateChange) onViewStateChange(next, canPushViewState === true ? method : "replace");
    else setLocal({ path, stateKey, state: next });
  }
  if (binding !== null && active.name === binding.name) {
    const bound = (
      <BoundAgentViewRenderer
        slug={binding.slug}
        embedded={isFrameless(mode)}
        strip={mode === "strip"}
        path={path}
        params={params}
        ownedViewState={viewState}
        canPushViewState={canPushViewState}
        {...(onViewStateChange !== undefined ? { onViewStateChange } : {})}
        onNavigate={onNavigate}
        renderInline={renderInline}
      />
    );
    // An authored view draws no caption of its own; an embed's `![caption]`
    // goes beneath it, as a built-in renderer shows it.
    return caption !== undefined && caption.trim() !== "" ? <CaptionedFigure caption={caption}>{bound}</CaptionedFigure> : bound;
  }
  return <active.Component data={data} onNavigate={onNavigate} params={params} mode={mode} caption={caption} workspacePdf={props.workspacePdf}
    viewState={builtinState} canPushViewState={canPushViewState} onViewStateChange={handleBuiltinState} />;
}

/** Registry marker; FileView renders the stable bound renderer directly. */
export function AuthoredRendererMarker(): null {
  return null;
}
