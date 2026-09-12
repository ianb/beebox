import { useWorkspace } from "../components/chat/workspace/WorkspaceProvider";
/**
 * Standard "navigate to a view URL" handler for {@link Markdown} / {@link FileView}.
 *
 * Product call sites open the target in the persistent workspace. The provider
 * sits above both the app bar and routed content, so every navigation affordance
 * shares the same retained tabs and browser-history owner.
 *
 * Surfaces that need different semantics (swap a sidebar pane, keep the browse
 * layout) build their own handler instead of using this hook.
 */

import { useCallback } from "react";
import { type NavigateHint, type ViewTarget } from "../lib/view-url";
import { invariant } from "@shared/invariant";

export function useViewNavigate(): (target: ViewTarget, hint?: NavigateHint) => void {
  const workspace = useWorkspace();
  invariant(workspace, "useViewNavigate requires WorkspaceProvider");
  return useCallback(
    (target: ViewTarget, hint?: NavigateHint) => {
      workspace.open(target, hint);
    },
    [workspace],
  );
}
