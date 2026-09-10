import type { ActivityKind } from "@core/chat/card-activity.js";
import type { AddSelectionInput } from "../lib/selection/position";
import type { NavigateHint, ViewState, ViewTarget } from "../lib/view-url";

export type FileViewMode = "chat" | "companion" | "embed";

export interface FileViewProps {
  path: string;
  mode?: FileViewMode;
  /** Force a renderer by name, usually from the surface's `?view=` value. */
  rendererName?: string | null;
  /** Let the surface own renderer choice instead of keeping it locally. */
  onSelectRenderer?: (name: string | null) => void;
  /** Open a link according to the surrounding surface's navigation semantics. */
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  /** Surface selected text to a surrounding chat composer. */
  onAddSelection?: (selection: AddSelectionInput) => void;
  /** Report companion-pane activity; absent elsewhere. */
  reportActivity?: (kind: ActivityKind, detail?: string) => void;
  onOpenInPanel?: () => void;
  /** External renderer configuration, excluding reserved view state. */
  params?: Record<string, string>;
  /** Explicit authored navigation state supplied by this surface. */
  viewState?: ViewState | null;
  /** True only when this mount owns a browser URL and can push history. */
  canPushViewState?: boolean;
  /** Persist state in the owner; omission keeps it local to this FileView. */
  onViewStateChange?: (next: ViewState, method: "push" | "replace") => void;
  caption?: string;
  onClose?: () => void;
}
