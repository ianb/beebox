/**
 * The root question: the one pending question a new box starts with, so its
 * first screen is the start of a conversation rather than a tour of the tool
 * (docs/plans/front-door.md, Track A). The empty root chat shows the newest
 * pending question as the agent's opening line; on a fresh box that is this
 * card. The agent answers it from the chat (`bbx answer --via chat`) after
 * doing what its directive says.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBoxDir } from "../../../lib/paths/core.js";
import { getBoxTimeISO } from "../../../lib/time.js";
import { createTextQuestionTemplate } from "../../../schemas/question.js";

/** What the box asks first. The chat shows it verbatim and uses it as the composer's placeholder. */
export const ROOT_QUESTION_PROMPT = "What do you want to keep track of here?";

/** Box-relative path of the seeded card. A fixed name: the seed runs once, on a box with no questions. */
export const ROOT_QUESTION_PATH = "_bookkeeping/questions/what-to-keep-track-of.question.card";

/**
 * Write the root question on a box that has no question cards yet. Returns the
 * card's box-relative path when written, null when the box already holds any
 * question card (answered or not: a box that has been asked anything is not
 * new, and this never asks twice). Fresh install only; the repair path
 * (`bbx wakeup` housekeeping) does not call this.
 *
 * No `expires-after`: the default window applies, and aging runs only on a
 * wakeup, which a fresh box does not schedule, so the question stays pending
 * until it is answered or dismissed. That is intended: a box that has never
 * been told its purpose keeps asking, quietly, with "Not now" one tap away.
 */
export async function installRootQuestion(boxRoot: string): Promise<string | null> {
  const dir = getBoxDir(boxRoot, "questions");
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir);
  if (entries.some((name) => name.endsWith(".question.card"))) return null;
  const content = createTextQuestionTemplate({
    prompt: ROOT_QUESTION_PROMPT,
    memo: "I'd like to know what this box is for before I suggest anything.",
    askedAt: getBoxTimeISO(boxRoot),
    learning: { sink: "briefing", ref: "_content/briefing.briefing.card", proposal: "This box is for <what the person said>." },
    directive: "Write the purpose into the briefing card in the person's words. Write two or three sentences on the Box page (the root landmark's body, _content/Box.landmark.card) in their words. Replace the stock openers on that landmark with openers for what they said, or remove them.",
  });
  await fs.writeFile(path.join(boxRoot, ROOT_QUESTION_PATH), content, { flag: "wx" });
  return ROOT_QUESTION_PATH;
}
