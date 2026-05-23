/**
 * Agent-shaped context summary for the webapp.
 *
 * A compact view of inbox count, pending questions (with prompts and options
 * loaded from each card), and a one-line human-readable summary. Used by the
 * status tRPC router and the /api/context HTTP route. The fuller per-card
 * inventory lives in `getSystemState()` in core/state.ts.
 */

import * as fs from "node:fs/promises";
import { requireBoxRoot } from "../cli/lib/paths.js";
import { getSystemState } from "../core/state.js";
import { parseCardText } from "../core/card-io.js";
import { createCardSchemaMap } from "../schemas/registry.js";
import type { QuestionFields } from "../schemas/question.js";

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
  const schemas = createCardSchemaMap();

  const pendingQuestions: PendingQuestion[] = [];

  for (const q of state.questions) {
    if (q.status !== "pending") continue;

    try {
      const content = await fs.readFile(q.path, "utf-8");
      const card = parseCardText(content, { source: q.path, schemas });
      const fields = card.fields as unknown as QuestionFields;
      const options = fields.input.options?.map((o) => o.label);
      pendingQuestions.push({
        path: q.relativePath,
        prompt: fields.prompt,
        options: options && options.length > 0 ? options : undefined,
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
