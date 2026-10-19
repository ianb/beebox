// # `bbx answer` — the guarded answer transition
//
// Answering a question is a single atomic step: it flips the card to `answered`,
// writes a follow-up job carrying the directive (and any `learning:`), and commits
// BOTH in one commit. Every input type normalizes correctly; `expired` and
// `dismissed` questions stay answerable; only `answered` is terminal.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, str } from "@ianbicking/tap-check/check";
import { executeAnswer } from "../../../src/core/commands/answer.js";
import { createCollectorContext } from "../../../src/core/command-runner.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import type { TmpBox } from "../../helpers/test-helpers.js";
import { execSync } from "node:child_process";

const QUESTIONS = "_bookkeeping/questions";

// Files touched by the HEAD commit, sorted.
function headFiles(root: string) {
  return execSync("git diff-tree --no-commit-id --name-only -r --relative HEAD", { cwd: root, stdio: "pipe" })
    .toString()
    .trim()
    .split("\n")
    .toSorted();
}

/**
 * Answer a question on a throwaway box. `content` (optional) is written to
 * `_bookkeeping/questions/<name>`; `args` may be a function of the box. Returns the
 * command's `success`/`error` plus the card text afterwards (null when absent), the
 * follow-up job text (null when there is none), the job files left behind and the
 * HEAD commit's files (git boxes only).
 */
async function answerOn({ name, content, args, git }: {
  name: string;
  content?: string;
  args: Record<string, unknown> | ((box: TmpBox) => Record<string, unknown>);
  git?: boolean | "none";
}) {
  const box = await makeTmpBox({ git: git ?? true });
  try {
    const rel = `${QUESTIONS}/${name}`;
    if (content !== undefined) await box.write(rel, content);
    const { ctx } = createCollectorContext(box.root);
    const res = await executeAnswer(ctx, { question: rel, ...(typeof args === "function" ? args(box) : args) });
    const jobFiles = (await box.list("_bookkeeping/jobs")).split("\n").filter((f) => f.endsWith(".card"));
    const [jobFile] = jobFiles;
    return {
      success: res.success,
      error: res.error,
      card: content === undefined ? null : await box.read(rel),
      job: jobFiles.length === 1 && jobFile !== undefined ? await box.read(jobFile) : null,
      jobFiles,
      committed: git === "none" ? null : headFiles(box.root),
    };
  } finally {
    await box.cleanup();
  }
}

const JOB_FILE = str`_bookkeeping/jobs/${any(String)}.question-followup.job.card`;

/** What a successful answer leaves: the answered card, one follow-up job, and one commit holding both. */
function answered({ question, card, job }: { question: string; card: ReturnType<typeof str>; job: string }) {
  return {
    success: true,
    error: undefined,
    card,
    job,
    jobFiles: [JOB_FILE],
    committed: [JOB_FILE, `${QUESTIONS}/${question}`],
  };
}

/** What a rejected answer leaves: the card as it was, and no job or commit. */
function rejected(error: string, card: string | null) {
  return { success: false, error, card, job: null, jobFiles: [], committed: [""] };
}

const SELECT = `---
prompt: Where does this receipt go?
input:
  type: select
  options:
    - {id: finance, label: Finance}
    - {id: personal, label: Personal}
directive: File the receipt
learning:
  sink: guide
  proposal: Receipts like this belong in finance/.
---
`;

const CONFIRM = `---
prompt: Archive this thread?
input:
  type: confirm
directive: Archive if yes
---
`;

const TEXT = `---
prompt: What should I name the project?
input:
  type: text
---
`;

const LETTER_LABELS = `---
prompt: Pick one
input:
  type: select
  options:
    - {id: first, label: b}
    - {id: second, label: Second}
directive: Use the picked option
---
`;


const SELECT_HEAD = `type: question
prompt: Where does this receipt go?
input:
  type: select
  options:
    - id: finance
      label: Finance
    - id: personal
      label: Personal
learning:
  sink: guide
  proposal: Receipts like this belong in finance/.
directive: File the receipt
`;

/** The answered card text: `head` and the `answer:` lines, then the stamp. */
const answeredCard = (head: string, answerLines: string) => str`---
${head}answer:
${answerLines}answered-at: ${isoDate()}
answered-via: cli
---
`;

const receiptJob = (answer: string) => `---
description: "Follow up on answered question: Where does this receipt go?"
question-ref:
  ref: _bookkeeping/questions/Receipt.question.card
directive: File the receipt
answer: ${answer}
learning:
  sink: guide
  proposal: Receipts like this belong in finance/.
---
`;

const ARCHIVE_HEAD = `type: question
prompt: Archive this thread?
input:
  type: confirm
directive: Archive if yes
`;

const archiveJob = (answer: string) => `---
description: "Follow up on answered question: Archive this thread?"
question-ref:
  ref: _bookkeeping/questions/Archive.question.card
directive: Archive if yes
answer: ${answer}
---
`;

const NAME_HEAD = `type: question
prompt: What should I name the project?
input:
  type: text
`;

const nameJob = (question: string) => `---
description: "Follow up on answered question: What should I name the project?"
question-ref:
  ref: _bookkeeping/questions/${question}
directive: Process the answer to this question
answer: Phoenix
---
`;

// ## Select — by letter, by label, by selectedId
//
// Answering `a` picks the first option; the card records the label as text and the
// option id as `selected`, and stamps `answered-at`. The follow-up job carries the
// directive AND the declared `learning:` passthrough:
void test("Answering a picks the first option; the card records the label as text and th...", async (t) => {
  const r = await answerOn({ name: "Receipt.question.card", content: SELECT, args: { answer: "a" } });
  t.check(r, answered({ question: "Receipt.question.card", card: answeredCard(SELECT_HEAD, "  text: Finance\n  selected: finance\n"), job: receiptJob("Finance") }));
});

// Answering by the option's label resolves the same id, and answering by
// `selectedId` alone (a direct API path) resolves the id to its label:
void test("Answering by the option's label resolves the same id, and answering by select...", async (t) => {
  const byLabel = await answerOn({ name: "Receipt.question.card", content: SELECT, args: { answer: "Personal" } });
  const byId = await answerOn({ name: "Receipt.question.card", content: SELECT, args: { selectedId: "finance" } });
  t.check(byLabel, answered({ question: "Receipt.question.card", card: answeredCard(SELECT_HEAD, "  text: Personal\n  selected: personal\n"), job: receiptJob("Personal") }));
  t.check(byId, answered({ question: "Receipt.question.card", card: answeredCard(SELECT_HEAD, "  text: Finance\n  selected: finance\n"), job: receiptJob("Finance") }));
});

// ## Select — label match wins over the letter-index shortcut
//
// An option can be labelled with a letter (e.g. "b") at a position that letter
// wouldn't naturally index to. Label matching runs before the letter-index
// shortcut, so typing that letter picks the matching label, not whatever
// option sits at that letter's position:
void test("An option can be labelled with a letter (e.g.", async (t) => {
  const r = await answerOn({ name: "Letters.question.card", content: LETTER_LABELS, args: { answer: "b" } });
  t.check(r, answered({ question: "Letters.question.card", card: str`---
type: question
prompt: Pick one
input:
  type: select
  options:
    - id: first
      label: b
    - id: second
      label: Second
directive: Use the picked option
answer:
  text: b
  selected: first
answered-at: ${isoDate()}
answered-via: cli
---
`, job: `---
description: "Follow up on answered question: Pick one"
question-ref:
  ref: _bookkeeping/questions/Letters.question.card
directive: Use the picked option
answer: b
---
` }));
});

// ## Confirm — by selectedId with a note, by typed yes/no, junk rejected
//
// The new UI path sends `selectedId: "yes" | "no"`; an optional free-text `answer`
// rides along as a note into `answer.text`. The follow-up job's answer folds the
// decision and the note together:
void test("The new UI path sends selectedId:", async (t) => {
  const r = await answerOn({ name: "Archive.question.card", content: CONFIRM, args: { selectedId: "yes", answer: "looks safe to archive" } });
  t.check(r, answered({ question: "Archive.question.card", card: answeredCard(ARCHIVE_HEAD, "  text: looks safe to archive\n  selected: yes\n"), job: archiveJob("yes (looks safe to archive)") }));
});

// A typed free-text `y` still normalizes to `yes`:
void test("A typed free-text y still normalizes to yes:", async (t) => {
  const r = await answerOn({ name: "Archive.question.card", content: CONFIRM, args: { answer: "y" } });
  t.check(r, answered({ question: "Archive.question.card", card: answeredCard(ARCHIVE_HEAD, "  text: yes\n  selected: yes\n"), job: archiveJob("yes") }));
});

// Junk is rejected — both a junk free-text answer and a junk `selectedId` — and
// the card stays pending after a rejected answer:
void test("Junk is rejected — both a junk free-text answer and a junk selectedId — and t...", async (t) => {
  const typedJunk = await answerOn({ name: "Archive.question.card", content: CONFIRM, args: { answer: "maybe" } });
  const idJunk = await answerOn({ name: "Archive.question.card", content: CONFIRM, args: { selectedId: "maybe" } });
  t.check(typedJunk, rejected("Confirm questions require a yes/no answer", CONFIRM));
  t.check(idJunk, rejected('Confirm answer must be "yes" or "no" (got "maybe")', CONFIRM));
});

// ## Text
void test("Text", async (t) => {
  const r = await answerOn({ name: "Name.question.card", content: TEXT, args: { answer: "Phoenix" } });
  t.check(r, answered({ question: "Name.question.card", card: answeredCard(NAME_HEAD, "  text: Phoenix\n"), job: nameJob("Name.question.card") }));
});

// ## Expired and dismissed are answerable; answered is terminal
//
// An expired question still accepts an answer (expiry demotes visibility, it does
// not close the question). A stored `expired-at` (required by the schema for an
// expired card) is cleared on re-answer, so the resulting card is coherent. So
// does a dismissed one (an un-dismissal is the boxholder's prerogative); its
// `dismissed-at` is likewise cleared:
void test("An expired question still accepts an answer (expiry demotes visibility, it do...", async (t) => {
  const stamp = (field: string) => TEXT.replace("---\n", `---\n${field}: 2026-01-01T00:00:00-07:00\n`);
  const expired = await answerOn({ name: "Old.question.card", content: stamp("expired-at"), args: { answer: "Phoenix" } });
  const dismissed = await answerOn({ name: "Skipped.question.card", content: stamp("dismissed-at"), args: { answer: "Phoenix" } });
  t.check(expired, answered({ question: "Old.question.card", card: answeredCard(NAME_HEAD, "  text: Phoenix\n"), job: nameJob("Old.question.card") }));
  t.check(dismissed, answered({ question: "Skipped.question.card", card: answeredCard(NAME_HEAD, "  text: Phoenix\n"), job: nameJob("Skipped.question.card") }));
});

// An already-answered question is rejected (a coherent answered card carries its
// `answer` + `answered-at`):
void test("An already-answered question is rejected (a coherent answered card carries it...", async (t) => {
  const ANSWERED = TEXT.replace("---\n", "---\nanswered-at: 2026-01-01T00:00:00-07:00\nanswer:\n  text: Done\n");
  const r = await answerOn({ name: "Done.question.card", content: ANSWERED, args: { answer: "Phoenix" } });
  t.check(r, rejected("Question is already answered; an answered question is terminal", ANSWERED));
});

// ## Path containment — absolute and traversal paths are rejected fail-closed
//
// A relative path that escapes the box via `../`, or an absolute path pointing
// outside it, is rejected before any transition runs (the card never loads):
void test("A relative path that escapes the box via ../, or an absolute path pointing ou...", async (t) => {
  const traversal = await answerOn({ name: "x", args: { question: "../../etc/passwd.card", answer: "x" } });
  const outside = await answerOn({ name: "x", args: { question: "/etc/passwd.card", answer: "x" } });
  t.check(traversal, rejected("Question path escapes the box: ../../etc/passwd.card", null));
  t.check(outside, rejected("Question path escapes the box: /etc/passwd.card", null));
});

// An absolute path that resolves INSIDE the box is accepted (the CLI may pass one):
void test("An absolute path that resolves INSIDE the box is accepted (the CLI may pass o...", async (t) => {
  const r = await answerOn({
    name: "Name.question.card",
    content: TEXT,
    args: (box) => ({ question: `${box.root}/_bookkeeping/questions/Name.question.card`, answer: "Phoenix" }),
  });
  t.check(r, answered({ question: "Name.question.card", card: answeredCard(NAME_HEAD, "  text: Phoenix\n"), job: nameJob("Name.question.card") }));
});

// ## Single commit — card and job land together
//
// The answered card and its follow-up job are committed in ONE commit, so a
// failure can never strand an answered card without its job:
void test("The answered card and its follow-up job are committed in ONE commit, so a fai...", async (t) => {
  const r = await answerOn({ name: "Receipt.question.card", content: SELECT, args: { answer: "a" } });
  t.check(r.committed, [JOB_FILE, "_bookkeeping/questions/Receipt.question.card"]);
});

// ## Rollback — a failed commit leaves the question pending and retryable
//
// Because the filesystem writes are not atomic with the commit, a commit failure
// must roll back. Here the box has no git repo, so the commit throws; the answer
// restores the original card and deletes the job before returning the error. The
// card is untouched (still pending) and no job file was left behind:
void test("Because the filesystem writes are not atomic with the commit, a commit failur...", async (t) => {
  const r = await answerOn({ name: "Receipt.question.card", content: SELECT, args: { answer: "a" }, git: "none" });
  t.check(r, {
    success: false,
    error: str`Failed to commit transition: ${any(String)}`,
    card: SELECT,
    job: null,
    jobFiles: [],
    committed: null,
  });
});
