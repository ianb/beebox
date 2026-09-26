/**
 * The workspace pane a component renders in, and the opener built on it
 * (`docs/plans/todos-ui.md`, Track 5).
 *
 * `WorkspaceCanvas` provides `WorkspacePaneContext` around each pane's card,
 * so anything a card renders — including a card peeked inside it — knows its
 * pane without a prop. `useOpenBeside` returns `null` where the link should
 * stay a plain `href` (`open-beside.ts`).
 */

import { createContext, useContext } from "react";
import { useWorkspace } from "./WorkspaceProvider";
import { listLinkRoute } from "./open-beside";
import type { PaneId } from "./workspace-state";
import type { ViewTarget } from "../../../lib/view-url";

export const WorkspacePaneContext = createContext<PaneId | null>(null);

export function cardTarget(path: string): ViewTarget {
  return { path, viewer: null, params: {}, viewState: null };
}

export function useOpenBeside(): ((target: ViewTarget) => void) | null {
  const workspace = useWorkspace();
  const pane = useContext(WorkspacePaneContext);
  const route = listLinkRoute({ workspace: workspace !== null, mobile: workspace?.mobile ?? false, pane });
  if (workspace === null || route.kind === "href") return null;
  return (target) => workspace.open(target, { label: target.path, destinationPane: route.destinationPane });
}
