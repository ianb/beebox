/**
 * A question beside the chat (docs/plans/questions-beside-the-chat.md,
 * Track B): closing the tab of a pending question is "Not now", which
 * dismisses the card. Answered, dismissed, and expired questions close like
 * any card. Only the person's close does this; the workspace evicting a tab
 * at its cap or retargeting one never goes through here.
 */

import { useCallback } from "react";
import { trpc } from "../../lib/trpc/client";
import { toastError } from "../ui/toast-store";
import { useWorkspace } from "../chat/workspace/WorkspaceProvider/provider";
import { cardTarget } from "../chat/workspace/use-open-beside/hook";
import { revealConversationActions } from "../chat/workspace/history";
import type { QuestionInfo } from "./QuestionForm/view";

/** The label a pending question's close control carries. */
export const NOT_NOW = "Not now";

export function isQuestionPath(path: string): boolean {
  return path.endsWith(".question.card");
}

/** Whether closing this tab dismisses its question: a question card the list shows as pending. */
export function dismissesOnClose(path: string, items: readonly QuestionInfo[]): boolean {
  if (!isQuestionPath(path)) return false;
  return items.some((q) => q.relativePath === path && q.state === "pending" && q.invalid !== true);
}

/**
 * Dismisses a question whose tab the person closed, when it is pending. The
 * tab is already closed; a failure keeps the card pending and says so.
 */
export function useDismissOnClose(): (path: string) => void {
  const utils = trpc.useUtils();
  return useCallback((path: string) => {
    if (!isQuestionPath(path)) return;
    void (async () => {
      try {
        const data = await utils.status.questions.fetch();
        if (!dismissesOnClose(path, data.items)) return;
        await utils.client.actions.dismiss.mutate({ questionPath: path });
        await utils.status.questions.invalidate();
      } catch (cause) {
        toastError("That question is still waiting.", { cause });
      }
    })();
  }, [utils]);
}

/**
 * The close label for each tab: "Not now" for a pending question, null for
 * any other card. Queries the question list only when a question tab is open.
 */
export function useQuestionCloseLabel(paths: readonly string[]): (path: string) => string | null {
  const any = paths.some(isQuestionPath);
  const { data } = trpc.status.questions.useQuery(undefined, { enabled: any });
  return useCallback((path: string) => (data !== undefined && dismissesOnClose(path, data.items) ? NOT_NOW : null), [data]);
}

/**
 * "Answer in chat" on a Questions page row: opens the question as a card in
 * the workspace and makes sure the chat is beside it. With the chat in one
 * pane and the Questions page in the other, the workspace opens the card in
 * the card pane, the page's own; with the chat hidden on the desktop, the
 * chat is revealed opposite the question. On the phone the card takes the
 * screen with the composer under it. Undefined outside a workspace.
 */
export function useAnswerInChat(): ((path: string) => void) | undefined {
  const workspace = useWorkspace();
  if (workspace === null) return undefined;
  return (path: string) => {
    workspace.open(cardTarget(path), { label: path });
    if (workspace.mobile) return;
    for (const action of revealConversationActions({ state: workspace.store.get(), cardPath: path, viewport: "desktop" })) workspace.dispatch(action);
  };
}
