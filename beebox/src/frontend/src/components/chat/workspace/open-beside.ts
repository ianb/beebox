/**
 * Where a link from a list opens (`docs/plans/todos-ui.md`, Track 5).
 *
 * A list — the todo list, a directory's todo line — is something one reads
 * beside the thing it leads to. On the desktop, a card opened from a list in
 * one pane opens in the other, so the list stays in view. On a phone there is
 * one pane, and the workspace's own mobile rule places the card. Where the
 * surface is not in a workspace pane at all, the link keeps its plain `href`.
 */

import { oppositePane, type PaneId } from "./workspace-state-model.js";

export type ListLinkRoute =
  | { kind: "href" }
  | { kind: "open"; destinationPane: PaneId | undefined };

export function listLinkRoute(at: { workspace: boolean; mobile: boolean; pane: PaneId | null }): ListLinkRoute {
  if (!at.workspace || at.pane === null) return { kind: "href" };
  if (at.mobile) return { kind: "open", destinationPane: undefined };
  return { kind: "open", destinationPane: oppositePane(at.pane) };
}
