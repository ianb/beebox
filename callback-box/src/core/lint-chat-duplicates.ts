/**
 * The one cross-file card-lint rule: two husks must never claim one chat.
 *
 * A husk's `session` field is its only identity — the filename is a naming
 * convention (`docs/plans/chat-session-identity.md`). `ensureChatHusk` is
 * idempotent on that field, so nothing *creates* a duplicate any more, but a
 * box can still hold one from before that fix, from a copied card, or from a
 * hand-edit. Nothing else would notice: both cards load, both appear in the
 * picker, and chat review would extend two accounts from one conversation.
 *
 * Every other rule in card-lint is per-file, so this one carries the whole cost
 * of being cross-file: the index of `store/chat/**` is built once per
 * `lintCardsDispatch` run and memoized on that run's options object, never
 * rescanned per card. The repair is editorial (which husk's title and body do
 * you keep?), so the rule reports and never repairs.
 */

import * as path from "node:path";
import type { LintIssue } from "../cards/index.js";
import { groupHusksBySession, listChatHusksTree } from "./chat/husk-read.js";

/**
 * `session` → the box-relative husk paths carrying it, per lint run. Keyed on
 * the run's options object so the scan happens once and dies with the run;
 * a `WeakMap` rather than a field on `LintDispatchOptions` because callers
 * construct that object and shouldn't have to carry a cache slot.
 */
const runIndexes = new WeakMap<object, Promise<Map<string, string[]>>>();

function sessionIndex(input: { boxRoot: string; run: object }): Promise<Map<string, string[]>> {
  const cached = runIndexes.get(input.run);
  if (cached !== undefined) return cached;
  const built = listChatHusksTree(input.boxRoot).then(groupHusksBySession);
  runIndexes.set(input.run, built);
  return built;
}

/**
 * Error when another card under `store/chat/**` carries this card's `session`.
 * Both paths are named because either one may be the keeper — the rule can't
 * know which, and says so rather than guessing.
 */
export async function lintDuplicateChatSession(input: {
  path: string;
  fields: Record<string, unknown>;
  boxRoot: string;
  run: object;
}): Promise<LintIssue[]> {
  const session = input.fields["session"];
  if (typeof session !== "string" || session === "") return [];
  const index = await sessionIndex({ boxRoot: input.boxRoot, run: input.run });
  const relPath = path.relative(input.boxRoot, input.path).split(path.sep).join("/");
  const others = (index.get(session) ?? []).filter((other) => other !== relPath);
  if (others.length === 0) return [];
  return [{
    type: "validation",
    severity: "error",
    message:
      `Duplicate chat session ${session}: ${relPath} and ${others.join(", ")} ` +
      "are husks for one chat. Keep whichever card you want the chat to be, " +
      "and `cb trash` the other.",
  }];
}
