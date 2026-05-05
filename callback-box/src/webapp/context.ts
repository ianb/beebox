/**
 * Agent-shaped context summary for the webapp.
 *
 * A compact view of inbox count, pending questions (with prompts and options
 * loaded from each card), and a one-line human-readable summary. Used by the
 * status tRPC router and the /api/context HTTP route. The fuller per-card
 * inventory lives in `getSystemState()` in core/state.ts.
 */

import type { ElementNode } from "cardworks";
import { createLoader } from "../cli/lib/loader.js";
import { requireBoxRoot } from "../cli/lib/paths.js";
import { getSystemState } from "../core/state.js";

export interface PendingQuestion {
  path: string;
  prompt: string;
  options?: string[] | undefined;
}

export interface ContextOutput {
  summary: string;
  pendingQuestions: PendingQuestion[];
  inboxCount: number;
}

export async function generateContext(boxRoot?: string): Promise<ContextOutput> {
  const root = boxRoot ?? await requireBoxRoot();
  const state = await getSystemState(root);
  const loader = await createLoader(root);

  const pendingQuestions: PendingQuestion[] = [];

  for (const q of state.questions) {
    if (q.status !== "pending") continue;

    try {
      const card = await loader.load(q.path);
      const element = card.element;

      let prompt = "";
      let options: string[] | undefined;

      for (const child of element.children as ElementNode[]) {
        if (child.tagName === "prompt") {
          prompt = child.text ?? "";
        }
        if (child.tagName === "input") {
          const opts = (child.children as ElementNode[])
            .filter((c: ElementNode) => c.tagName === "option")
            .map((c: ElementNode) => c.text ?? "");
          if (opts.length > 0) {
            options = opts;
          }
        }
      }

      pendingQuestions.push({
        path: q.relativePath,
        prompt,
        options,
      });
    } catch {
      // Skip invalid cards
    }
  }

  const parts: string[] = [];

  if (state.inbox.length > 0) {
    parts.push(`${state.inbox.length} item(s) in inbox`);
  }

  if (pendingQuestions.length > 0) {
    parts.push(`${pendingQuestions.length} pending question(s)`);
  }

  if (!state.git.clean) {
    const changes = state.git.modified.length + state.git.untracked.length;
    parts.push(`${changes} uncommitted change(s)`);
  }

  const summary = parts.length > 0
    ? parts.join(", ")
    : "System is idle - no pending items";

  return {
    summary,
    pendingQuestions,
    inboxCount: state.inbox.length,
  };
}
