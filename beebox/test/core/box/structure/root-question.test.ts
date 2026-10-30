// # installRootQuestion — the one question a new box starts with
//
// A fresh box's first screen is a question the chat asks, not a tour
// (docs/implemented-plans/front-door.md, Track A). `bbx init` seeds one pending text
// question with the prompt the chat shows, a memo, a directive, and a learning
// aimed at the root briefing. The seed runs once: a box that already holds any
// question card, answered or not, is left alone.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate, str } from "@ianbicking/tap-check/check";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installRootQuestion } from "../../../../src/core/box/structure/root-question.js";
import { ROOT_QUESTION_PATH } from "../../../../src/core/box/root-question-path.js";
import { parseFrontmatterObject } from "../../../../src/cards/frontmatter.js";
import { questionState } from "../../../../src/schemas/question.js";

async function makeBox() {
  const dir = await mkdtemp(join(tmpdir(), "rq-"));
  await mkdir(join(dir, "_bookkeeping"), { recursive: true });
  return dir;
}

// A box with no questions gets the root question, pending, with the fields the
// chat and the agent read; a second call writes nothing.
void test("A box with no questions gets the root question, pending; a second call writes nothing", async (t) => {
  const box = await makeBox();
  const first = await installRootQuestion(box);
  const again = await installRootQuestion(box);
  const content = await readFile(join(box, ROOT_QUESTION_PATH), "utf8");
  const fields = parseFrontmatterObject(content);
  t.check({ first, again, files: await readdir(join(box, "_bookkeeping/questions")), state: fields === null ? null : questionState(fields) }, {
    first: "_bookkeeping/questions/what-to-keep-track-of.question.card",
    again: null,
    files: ["what-to-keep-track-of.question.card"],
    state: "pending",
  });
  t.check(content, str`---
title: What this box is for
memo: I'd like to know what this box is for before I suggest anything.
prompt: What do you want to keep track of here?
input:
  type: text
learning:
  sink: briefing
  ref: /_content/briefing.briefing.card
  proposal: The box does not know yet what it is for.
directive: Write the purpose into the briefing card in the person's words. Write two or three sentences on the Box page (the root landmark's body, _content/Box.landmark.card) in their words. Replace the stock openers on that landmark with openers for what they said, or remove them. Then reflect back what they said in a sentence and offer two or three things the box could do for that, in their words; nothing about what the box can do before this.
asked-at: ${isoDate()}
---
`);
});

// A box that already holds a question card, whatever its state, is not a new
// box: nothing is written.
void test("A box that already holds a question card is untouched", async (t) => {
  const box = await makeBox();
  await mkdir(join(box, "_bookkeeping/questions"), { recursive: true });
  await writeFile(join(box, "_bookkeeping/questions/Old.question.card"), "---\nprompt: Old?\ninput:\n  type: text\nanswered-at: 2026-01-01T00:00:00Z\nanswer:\n  text: yes\n---\n");
  t.check({ result: await installRootQuestion(box), files: await readdir(join(box, "_bookkeeping/questions")) }, {
    result: null,
    files: ["Old.question.card"],
  });
});
