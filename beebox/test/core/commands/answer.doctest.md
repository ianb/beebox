# `bbx answer` — the guarded answer transition

Answering a question is a single atomic step: it flips the card to `answered`,
writes a follow-up job carrying the directive (and any `learning:`), and commits
BOTH in one commit. Every input type normalizes correctly; `expired` and
`dismissed` questions stay answerable; only `answered` is terminal.

```ts setup
import { executeAnswer } from "../../../src/core/commands/answer.js";
import { createCollectorContext } from "../../../src/core/command-runner.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { execSync } from "node:child_process";

const QUESTIONS = "_bookkeeping/questions";

// Files touched by the HEAD commit, one path per line, sorted.
function headFiles(root) {
  return execSync("git diff-tree --no-commit-id --name-only -r --relative HEAD", { cwd: root, stdio: "pipe" })
    .toString()
    .trim()
    .split("\n")
    .sort()
    .join("\n");
}

/**
 * Answer a question on a throwaway box. `content` (optional) is written to
 * `_bookkeeping/questions/<name>`; `args` may be a function of the box. Returns the
 * command's `success`/`error` plus the card text afterwards (null when absent), the
 * follow-up job text (null when there is none), the HEAD commit's files (git boxes
 * only) and the raw jobs listing.
 */
async function answerOn({ name, content, args, git }) {
  const box = await makeTmpBox({ git: git ?? true });
  try {
    const rel = `${QUESTIONS}/${name}`;
    if (content !== undefined) await box.write(rel, content);
    const { ctx } = createCollectorContext(box.root);
    const res = await executeAnswer(ctx, { question: rel, ...(typeof args === "function" ? args(box) : args) });
    const jobsListing = await box.list("_bookkeeping/jobs");
    const jobFiles = jobsListing.split("\n").filter((f) => f.endsWith(".card"));
    return {
      success: res.success,
      error: res.error,
      card: content === undefined ? null : await box.read(rel),
      job: jobFiles.length === 1 ? await box.read(jobFiles[0]) : null,
      jobsListing,
      committed: git === "none" ? null : headFiles(box.root),
    };
  } finally {
    await box.cleanup();
  }
}

/** Which of `needles` appear in `text`, as { needle: boolean }. */
const contains = (text, ...needles) => Object.fromEntries(needles.map((n) => [n, text.includes(n)]));

/** The `selected` id and answer `text` recorded on an answered card. */
const recorded = (card) => ({ selected: card.match(/selected: (.*)/)?.[1], text: card.match(/text: (.*)/)?.[1] });

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
```

## Select — by letter, by label, by selectedId

Answering `a` picks the first option; the card records the label as text and the
option id as `selected`, and stamps `answered-at`:

```ts
const r = await answerOn({ name: "Receipt.question.card", content: SELECT, args: { answer: "a" } });
({ success: r.success, ...recorded(r.card), ...contains(r.card, "answered-at:") })
=> { success: true, selected: "finance", text: "Finance", "answered-at:": true }
```

The follow-up job carries the directive AND the declared `learning:` passthrough:

```ts continue
contains(r.job, "directive: File the receipt", "answer: Finance", "Receipts like this belong in finance/.")
=> { "directive: File the receipt": true, "answer: Finance": true, "Receipts like this belong in finance/.": true }
```

Answering by the option's label resolves the same id, and answering by
`selectedId` alone (a direct API path) resolves the id to its label:

```ts
const byLabel = await answerOn({ name: "Receipt.question.card", content: SELECT, args: { answer: "Personal" } });
const byId = await answerOn({ name: "Receipt.question.card", content: SELECT, args: { selectedId: "finance" } });
({ byLabel: [byLabel.success, recorded(byLabel.card).selected], byId: [byId.success, recorded(byId.card).text] })
=> { byLabel: [true, "personal"], byId: [true, "Finance"] }
```

## Select — label match wins over the letter-index shortcut

An option can be labelled with a letter (e.g. "b") at a position that letter
wouldn't naturally index to. Label matching runs before the letter-index
shortcut, so typing that letter picks the matching label, not whatever
option sits at that letter's position:

```ts
const r = await answerOn({ name: "Letters.question.card", content: LETTER_LABELS, args: { answer: "b" } });
({ success: r.success, selected: recorded(r.card).selected })
=> { success: true, selected: "first" }
```

## Confirm — by selectedId with a note, by typed yes/no, junk rejected

The new UI path sends `selectedId: "yes" | "no"`; an optional free-text `answer`
rides along as a note into `answer.text`. The follow-up job's answer folds the
decision and the note together:

```ts
const r = await answerOn({ name: "Archive.question.card", content: CONFIRM, args: { selectedId: "yes", answer: "looks safe to archive" } });
({ success: r.success, selected: recorded(r.card).selected, ...contains(r.card, "looks safe to archive"), ...contains(r.job, "yes (looks safe to archive)") })
=> { success: true, selected: "yes", "looks safe to archive": true, "yes (looks safe to archive)": true }
```

A typed free-text `y` still normalizes to `yes`:

```ts
const r = await answerOn({ name: "Archive.question.card", content: CONFIRM, args: { answer: "y" } });
({ success: r.success, selected: recorded(r.card).selected })
=> { success: true, selected: "yes" }
```

Junk is rejected — both a junk free-text answer and a junk `selectedId` — and
the card stays pending after a rejected answer:

```ts
const typedJunk = await answerOn({ name: "Archive.question.card", content: CONFIRM, args: { answer: "maybe" } });
const idJunk = await answerOn({ name: "Archive.question.card", content: CONFIRM, args: { selectedId: "maybe" } });
({
  typed: typedJunk.error,
  selectedId: idJunk.error,
  pending: [typedJunk, idJunk].every((r) => !r.card.includes("answered-at")),
})
=> {
  typed: "Confirm questions require a yes/no answer",
  selectedId: "Confirm answer must be \"yes\" or \"no\" (got \"maybe\")",
  pending: true
}
```

## Text

```ts
const r = await answerOn({ name: "Name.question.card", content: TEXT, args: { answer: "Phoenix" } });
({ success: r.success, text: recorded(r.card).text })
=> { success: true, text: "Phoenix" }
```

## Expired and dismissed are answerable; answered is terminal

An expired question still accepts an answer (expiry demotes visibility, it does
not close the question). A stored `expired-at` (required by the schema for an
expired card) is cleared on re-answer, so the resulting card is coherent. So
does a dismissed one (an un-dismissal is the boxholder's prerogative); its
`dismissed-at` is likewise cleared:

```ts
const stamp = (field) => TEXT.replace("---\n", `---\n${field}: 2026-01-01T00:00:00-07:00\n`);
const expired = await answerOn({ name: "Old.question.card", content: stamp("expired-at"), args: { answer: "Phoenix" } });
const dismissed = await answerOn({ name: "Skipped.question.card", content: stamp("dismissed-at"), args: { answer: "Phoenix" } });
({
  expired: { success: expired.success, ...contains(expired.card, "answered-at:", "expired-at") },
  dismissed: { success: dismissed.success, ...contains(dismissed.card, "answered-at:", "dismissed-at") },
})
=> {
  expired: { success: true, "answered-at:": true, "expired-at": false },
  dismissed: { success: true, "answered-at:": true, "dismissed-at": false }
}
```

An already-answered question is rejected (a coherent answered card carries its
`answer` + `answered-at`):

```ts
const ANSWERED = TEXT.replace("---\n", "---\nanswered-at: 2026-01-01T00:00:00-07:00\nanswer:\n  text: Done\n");
const r = await answerOn({ name: "Done.question.card", content: ANSWERED, args: { answer: "Phoenix" } });
({ success: r.success, error: r.error })
=> { success: false, error: "Question is already answered; an answered question is terminal" }
```

## Path containment — absolute and traversal paths are rejected fail-closed

A relative path that escapes the box via `../`, or an absolute path pointing
outside it, is rejected before any transition runs (the card never loads):

```ts
const traversal = await answerOn({ name: "x", args: { question: "../../etc/passwd.card", answer: "x" } });
const outside = await answerOn({ name: "x", args: { question: "/etc/passwd.card", answer: "x" } });
({
  traversal: [traversal.success, traversal.error.startsWith("Question path escapes the box:")],
  outside: [outside.success, outside.error.startsWith("Question path escapes the box:")],
})
=> { traversal: [false, true], outside: [false, true] }
```

An absolute path that resolves INSIDE the box is accepted (the CLI may pass one):

```ts
const r = await answerOn({
  name: "Name.question.card",
  content: TEXT,
  args: (box) => ({ question: `${box.root}/_bookkeeping/questions/Name.question.card`, answer: "Phoenix" }),
});
r.success
=> true
```

## Single commit — card and job land together

The answered card and its follow-up job are committed in ONE commit, so a
failure can never strand an answered card without its job:

```ts
const r = await answerOn({ name: "Receipt.question.card", content: SELECT, args: { answer: "a" } });
r.committed.split("\n").map((f) => f.replace(/jobs\/.*\.card$/, "jobs/«job»"))
=> ["_bookkeeping/jobs/«job»", "_bookkeeping/questions/Receipt.question.card"]
```

## Rollback — a failed commit leaves the question pending and retryable

Because the filesystem writes are not atomic with the commit, a commit failure
must roll back. Here the box has no git repo, so the commit throws; the answer
restores the original card and deletes the job before returning the error. The
card is untouched (still pending) and no job file was left behind:

```ts
const r = await answerOn({ name: "Receipt.question.card", content: SELECT, args: { answer: "a" }, git: "none" });
({
  success: r.success,
  failedToCommit: r.error.startsWith("Failed to commit transition:"),
  cardAnswered: r.card.includes("answered-at"),
  jobLeft: r.jobsListing.includes(".card"),
})
=> { success: false, failedToCommit: true, cardAnswered: false, jobLeft: false }
```
