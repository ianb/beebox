/**
 * The root question: the one pending question a new box starts with, so its
 * first screen is the start of a conversation rather than a tour of the tool
 * (docs/implemented-plans/front-door.md, Track A). The empty root chat shows the newest
 * pending question as the agent's opening line; on a fresh box that is this
 * card. The agent answers it from the chat (`bbx answer --via chat`) after
 * doing what its directive says.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBoxDir } from "../../../lib/paths/core.js";
import { getBoxTimeISO } from "../../../lib/time.js";
import { createTextQuestionTemplate } from "../../../schemas/question.js";
import { ROOT_QUESTION_PATH } from "../root-question-path.js";

/** What the box asks first. The chat shows it verbatim and uses it as the composer's placeholder. */
const ROOT_QUESTION_PROMPT = "What do you want to keep track of here?";

/** The briefing the answer is recorded in: root-relative, so it resolves from the card's own directory. */
const ROOT_QUESTION_REF = "/_content/briefing.briefing.card";

/** The belief the answer tests. Reads as a belief on the Questions page, where the person sees it. */
const ROOT_QUESTION_PROPOSAL = "The box does not know yet what it is for.";


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
    learning: { sink: "briefing", ref: ROOT_QUESTION_REF, proposal: ROOT_QUESTION_PROPOSAL },
    directive: "Write the purpose into the briefing card in the person's words. Write two or three sentences on the Box page (the root landmark's body, _content/Box.landmark.card) in their words. Replace the stock openers on that landmark with openers for what they said, or remove them. Then reflect back what they said in a sentence and offer two or three things the box could do for that, in their words; nothing about what the box can do before this.",
  });
  await fs.writeFile(path.join(boxRoot, ROOT_QUESTION_PATH), content, { flag: "wx" });
  return ROOT_QUESTION_PATH;
}
