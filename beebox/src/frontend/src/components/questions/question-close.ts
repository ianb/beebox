/**
 * The parts of a question tab the workspace itself uses: which question a new
 * root chat opens beside it, and putting a pending question away when the
 * person closes its tab. Kept apart from question-tab.ts, which reads the
 * workspace, so the workspace provider can import these without a cycle.
 */

import { useCallback } from "react";
import { trpc } from "../../lib/trpc/client";
import { toastError } from "../ui/toast-store";
import type { QuestionInfo } from "./QuestionForm/view";

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
