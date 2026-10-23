// # `root-question-2026-10`: the seeded root question is repaired
//
// New boxes seed the root question with a root-relative ref and a belief
// sentence. Boxes seeded before that hold a bare ref and the template sentence
// "This box is for <what the person said>.". The migration fixes both on a
// pending card, fixes only the ref on a card already answered, and leaves
// edited lines alone.

import { test } from "tap";
import * as fs from "node:fs/promises";
import "@ianbicking/tap-check/tap";
import { installRootQuestion } from "../../../src/core/box/structure/root-question.js";
import { ROOT_QUESTION_PATH } from "../../../src/core/box/root-question-path.js";
import { planRootQuestion } from "../../../src/scripts/migrate/root-question/plan.js";
import { runRootQuestion } from "../../../src/scripts/migrate/root-question/run.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const OLD_REF = "  ref: _content/briefing.briefing.card";
const OLD_PROPOSAL = "  proposal: This box is for <what the person said>.";

/** What a box seeded before the fix holds. */
async function oldSeed(root: string): Promise<string> {
  await installRootQuestion(root);
  const fresh = await fs.readFile(`${root}/${ROOT_QUESTION_PATH}`, "utf-8");
  return fresh
    .replace(/^ {2}ref: .*$/m, OLD_REF)
    .replace(/^ {2}proposal: .*$/m, OLD_PROPOSAL);
}

void test("A new box's seed is already current", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await installRootQuestion(box.root);
  const card = await box.read(ROOT_QUESTION_PATH);
  t.check({
    plan: planRootQuestion({ text: card }).kind,
    ref: /^ {2}ref: (.*)$/m.exec(card)?.[1],
    proposal: /^ {2}proposal: (.*)$/m.exec(card)?.[1],
  }, {
    plan: "current",
    ref: "/_content/briefing.briefing.card",
    proposal: "The box does not know yet what it is for.",
  });
});

void test("A pending old card gets both fixes; a rerun has nothing to do", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write(ROOT_QUESTION_PATH, await oldSeed(box.root));
  const dry = await runRootQuestion({ boxRoot: box.root, mode: "plan" });
  const unchanged = (await box.read(ROOT_QUESTION_PATH)).includes(OLD_REF);
  const applied = await runRootQuestion({ boxRoot: box.root, mode: "apply" });
  const card = await box.read(ROOT_QUESTION_PATH);
  const again = await runRootQuestion({ boxRoot: box.root, mode: "apply" });
  t.check({ dry: dry.lines, unchanged, applied: applied.lines, hasOld: card.includes(OLD_REF) || card.includes("<what the person said>"), again: again.lines }, {
    dry: [`would repair ${ROOT_QUESTION_PATH}: learning.ref made root-relative; learning.proposal replaced (dry run; pass --apply)`],
    unchanged: true,
    applied: [`root-question: repaired ${ROOT_QUESTION_PATH}: learning.ref made root-relative; learning.proposal replaced.`],
    hasOld: false,
    again: ["root-question: already current."],
  });
});

void test("An answered card keeps its proposal; an edited proposal stays", async (t) => {
  const answered = [
    "---", "learning:", OLD_REF, OLD_PROPOSAL, "answered-at: 2026-10-01T00:00:00Z", "---", "",
  ].join("\n");
  const edited = ["---", "learning:", OLD_REF, "  proposal: The person keeps bees.", "---", ""].join("\n");
  const plan = (text: string): string | undefined => {
    const result = planRootQuestion({ text });
    return result.kind === "write" ? result.text : undefined;
  };
  t.check({
    answered: plan(answered)?.split("\n").slice(2, 4),
    edited: plan(edited)?.split("\n").slice(2, 4),
  }, {
    answered: ["  ref: /_content/briefing.briefing.card", OLD_PROPOSAL],
    edited: ["  ref: /_content/briefing.briefing.card", "  proposal: The person keeps bees."],
  });
});

// The stock lines and `answered-at:` only count inside the frontmatter block;
// a body that quotes them is carried through byte for byte.
void test("Body text is never rewritten or read as a lifecycle field", async (t) => {
  const body = ["", "Notes:", OLD_REF, OLD_PROPOSAL, "answered-at: 2026-10-01T00:00:00Z", ""].join("\n");
  const quoted = ["---", "learning:", OLD_REF, "---", body].join("\n");
  const pendingWithBodyLifecycle = ["---", "learning:", OLD_REF, OLD_PROPOSAL, "---", body].join("\n");
  const bodyOnly = ["---", "prompt: Pick one", "---", body].join("\n");
  const plan = (text: string): string | undefined => {
    const result = planRootQuestion({ text });
    return result.kind === "write" ? result.text : undefined;
  };
  t.check({
    quoted: plan(quoted),
    pending: plan(pendingWithBodyLifecycle),
    bodyOnly: planRootQuestion({ text: bodyOnly }).kind,
  }, {
    quoted: ["---", "learning:", "  ref: /_content/briefing.briefing.card", "---", body].join("\n"),
    pending: [
      "---", "learning:", "  ref: /_content/briefing.briefing.card",
      "  proposal: The box does not know yet what it is for.", "---", body,
    ].join("\n"),
    bodyOnly: "current",
  });
});

void test("A box with no root question has nothing to do", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const result = await runRootQuestion({ boxRoot: box.root, mode: "apply" });
  t.check(result, { code: 0, lines: ["root-question: no root question card; nothing to do."] });
});
