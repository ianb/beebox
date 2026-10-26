/**
 * A question beside the chat (docs/plans/questions-beside-the-chat.md,
 * Track B): closing the tab of a pending question is "Later", which puts
 * the card away (the dismiss transition,
 * docs/plans/questions-later-and-figure-it-out.md). Answered, dismissed, and
 * expired questions close like any card. Only the person's close does this; the workspace evicting a tab
 * at its cap or retargeting one never goes through here.
 */

import { useCallback } from "react";
import { trpc } from "../../lib/trpc/client";
import { toastError } from "../ui/toast-store";
import { useWorkspace } from "../chat/workspace/WorkspaceProvider/provider";
import { cardTarget } from "../chat/workspace/use-open-beside/hook";
import { revealConversationActions } from "../chat/workspace/history";
import type { QuestionInfo } from "./QuestionForm/view";
import type { BesideActions } from "./QuestionBeside/view";
import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";

/**
 * The question a new root chat opens beside it: the newest pending card with
 * a prompt, by `asked-at` then by path. A card that failed to parse
 * (`invalid`) has nothing to ask and is never picked. Null when nothing is
 * pending.
 */
export function pickArrivalQuestion(items: readonly QuestionInfo[]): string | null {
  const askable = items
    .filter((q) => q.state === "pending" && q.invalid !== true && q.prompt !== undefined)
    .toSorted((a, b) => (b.askedAt ?? "").localeCompare(a.askedAt ?? "") || b.relativePath.localeCompare(a.relativePath));
  return askable[0]?.relativePath ?? null;
}

/** The label a pending question's close control and put-away button carry: the dismiss transition, put as "come back to it". */
export const LATER = "Later";

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
 * The close label for each tab: "Later" for a pending question, null for
 * any other card. Queries the question list only when a question tab is open.
 */
export function useQuestionCloseLabel(paths: readonly string[]): (path: string) => string | null {
  const any = paths.some(isQuestionPath);
  const { data } = trpc.status.questions.useQuery(undefined, { enabled: any });
  return useCallback((path: string) => (data !== undefined && dismissesOnClose(path, data.items) ? LATER : null), [data]);
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

/**
 * What the card beside the chat can do (docs/plans/questions-later-and-figure-it-out.md,
 * Track A): "Later" closes the tab, which puts the question away; "Figure it
 * out" hands it to the box in the background (`actions.figureOut`, which puts
 * it away itself) and closes the tab without a second put-away; "Answer in
 * the chat" reveals a hidden chat on the desktop. Undefined outside a
 * workspace tab, where the card is the Questions-page form.
 */
export function useBesideActions(path: string, companion: boolean): BesideActions | undefined {
  const workspace = useWorkspace();
  const utils = trpc.useUtils();
  const figureOut = trpc.actions.figureOut.useMutation({
    onSuccess: () => {
      void utils.status.questions.invalidate();
      if (workspace !== null) workspace.dispatch({ type: "closeTab", path, viewport: workspace.mobile ? "mobile" : "desktop" });
    },
    onError: (cause) => { toastError("The box couldn't start on that question.", { cause }); },
  });
  if (workspace === null || !companion) return undefined;
  const transcript = workspace.projection.transcript;
  return {
    onLater: () => workspace.onCloseTab(path),
    onFigureOut: () => figureOut.mutate({ questionPath: path }),
    figuring: figureOut.isPending,
    // On the phone the composer row stays under the card; on the desktop the chat can be hidden.
    onShowChat: workspace.mobile || workspace.transcriptVisible ? undefined : () => {
      for (const action of revealConversationActions({ state: workspace.store.get(), cardPath: path, viewport: "desktop" })) workspace.dispatch(action);
    },
    chatSide: workspace.mobile ? "below" : transcript === "left" ? "left" : "right",
  };
}

/** What the app bar's question counter does in a chat (docs/plans/questions-later-and-figure-it-out.md, Track B). */
export type QuestionToggle = { kind: "open"; path: string } | { kind: "hide"; path: string } | { kind: "page" };

/**
 * The counter's action: put away the pending question in front (hiding it,
 * not Later: it stays waiting), else bring the newest pending question beside
 * the chat, else open the Questions page.
 */
export function questionToggle(foregroundPath: string | null, items: readonly QuestionInfo[]): QuestionToggle {
  if (foregroundPath !== null && dismissesOnClose(foregroundPath, items)) return { kind: "hide", path: foregroundPath };
  const newest = pickArrivalQuestion(items);
  return newest === null ? { kind: "page" } : { kind: "open", path: newest };
}

/**
 * The counter as a show and hide for the question beside the chat, with the
 * label that says which; undefined outside a workspace, where the counter
 * links to the Questions page. The label reads the tab in front; the list is
 * fetched on the click, so the app bar costs no extra query at rest.
 */
export function useQuestionToggle(): { label: string; onToggle: () => void } | undefined {
  const workspace = useWorkspace();
  const answerInChat = useAnswerInChat();
  const utils = trpc.useUtils();
  if (workspace === null || answerInChat === undefined) return undefined;
  const front = workspace.projection.foregroundPath;
  return {
    label: front !== null && isQuestionPath(front) ? "Put the question away" : "Show the question",
    onToggle: () => {
      void (async () => {
        try {
          const action = questionToggle(front, (await utils.status.questions.fetch()).items);
          if (action.kind === "hide") workspace.dispatch({ type: "closeTab", path: action.path, viewport: workspace.mobile ? "mobile" : "desktop" });
          else if (action.kind === "open") answerInChat(action.path);
          else workspace.open(cardTarget(SYSTEM_CARD_PATHS.questions), { label: "Questions" });
        } catch (cause) {
          toastError("Couldn't load the questions.", { cause });
        }
      })();
    },
  };
}

/**
 * The pending question card in front, beside this chat, or null. The
 * empty chat then refers to it instead of offering openers
 * (docs/plans/questions-later-and-figure-it-out.md). Queries the question
 * list only while a question card is in front.
 */
export function useQuestionInFront(): string | null {
  const workspace = useWorkspace();
  const front = workspace?.projection.foregroundPath ?? null;
  const asking = front !== null && isQuestionPath(front);
  const { data } = trpc.status.questions.useQuery(undefined, { enabled: asking });
  return asking && data !== undefined && dismissesOnClose(front, data.items) ? front : null;
}
