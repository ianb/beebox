# `cb answer` — the guarded answer transition

Answering a question is a single atomic step: it flips the card to `answered`,
writes a follow-up job carrying the directive (and any `learning:`), and commits
BOTH in one commit. Every input type normalizes correctly; `expired` and
`dismissed` questions stay answerable; only `answered` is terminal.

```ts setup
import { executeAnswer } from "../../../src/core/commands/answer.js";
import { createCollectorContext } from "../../../src/core/commands/index.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { execSync } from "node:child_process";

async function answer(box, args) {
  const { ctx } = createCollectorContext(box.root);
  return executeAnswer(ctx, args);
}

// Files touched by the HEAD commit, one path per line, sorted.
function headFiles(root) {
  return execSync("git diff-tree --no-commit-id --name-only -r HEAD", { cwd: root, stdio: "pipe" })
    .toString()
    .trim()
    .split("\n")
    .sort()
    .join("\n");
}

// The single .card under box/jobs (the follow-up job), read back.
async function readJob(box) {
  const jobs = (await box.list("box/jobs")).split("\n").filter((f) => f.endsWith(".card"));
  if (jobs.length !== 1) throw new Error(`expected 1 job, found ${jobs.length}`);
  return box.read(jobs[0]);
}

const SELECT = `---
status: pending
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
status: pending
prompt: Archive this thread?
input:
  type: confirm
directive: Archive if yes
---
`;

const TEXT = `---
status: pending
prompt: What should I name the project?
input:
  type: text
---
`;
```

## Select — by letter, by label, by selectedId

Answering `a` picks the first option; the card records the label as text and the
option id as `selected`:

```ts
const box = await makeTmpBox({ git: true });
await box.write("box/questions/Receipt.question.card", SELECT);

const res = await answer(box, { question: "box/questions/Receipt.question.card", answer: "a" });
res.success
=> true

const card = await box.read("box/questions/Receipt.question.card");
card.includes("status: answered")
=> true

card.includes("selected: finance")
=> true

card.includes("text: Finance")
=> true
```

The follow-up job carries the directive AND the declared `learning:` passthrough:

```ts continue
const job = await readJob(box);
job.includes("directive: File the receipt")
=> true

job.includes("answer: Finance")
=> true

job.includes("Receipts like this belong in finance/.")
=> true
```

```ts cleanup
await box.cleanup();
```

Answering by the option's label resolves the same id:

```ts
const box = await makeTmpBox({ git: true });
await box.write("box/questions/Receipt.question.card", SELECT);

const res = await answer(box, { question: "box/questions/Receipt.question.card", answer: "Personal" });
res.success
=> true

const card = await box.read("box/questions/Receipt.question.card");
card.includes("selected: personal")
=> true
```

```ts cleanup
await box.cleanup();
```

Answering by `selectedId` alone (a direct API path) resolves the id to its label:

```ts
const box = await makeTmpBox({ git: true });
await box.write("box/questions/Receipt.question.card", SELECT);

const res = await answer(box, { question: "box/questions/Receipt.question.card", selectedId: "finance" });
res.success
=> true

(await box.read("box/questions/Receipt.question.card")).includes("text: Finance")
=> true
```

```ts cleanup
await box.cleanup();
```

## Confirm — by selectedId with a note, by typed yes/no, junk rejected

The new UI path sends `selectedId: "yes" | "no"`; an optional free-text `answer`
rides along as a note into `answer.text`:

```ts
const box = await makeTmpBox({ git: true });
await box.write("box/questions/Archive.question.card", CONFIRM);

const res = await answer(box, {
  question: "box/questions/Archive.question.card",
  selectedId: "yes",
  answer: "looks safe to archive",
});
res.success
=> true

const card = await box.read("box/questions/Archive.question.card");
card.includes("selected: yes")
=> true

card.includes("looks safe to archive")
=> true
```

The follow-up job's answer folds the decision and the note together:

```ts continue
(await readJob(box)).includes("yes (looks safe to archive)")
=> true
```

```ts cleanup
await box.cleanup();
```

A typed free-text `y` still normalizes to `yes`:

```ts
const box = await makeTmpBox({ git: true });
await box.write("box/questions/Archive.question.card", CONFIRM);

const res = await answer(box, { question: "box/questions/Archive.question.card", answer: "y" });
res.success
=> true

(await box.read("box/questions/Archive.question.card")).includes("selected: yes")
=> true
```

```ts cleanup
await box.cleanup();
```

Junk is rejected — both a junk free-text answer and a junk `selectedId`:

```ts
const box = await makeTmpBox({ git: true });
await box.write("box/questions/Archive.question.card", CONFIRM);

const typed = await answer(box, { question: "box/questions/Archive.question.card", answer: "maybe" });
typed.error
=> Confirm questions require a yes/no answer

const bad = await answer(box, { question: "box/questions/Archive.question.card", selectedId: "maybe" });
bad.error
=> Confirm answer must be "yes" or "no" (got "maybe")
```

The card stays pending after a rejected answer:

```ts continue
(await box.read("box/questions/Archive.question.card")).includes("status: pending")
=> true
```

```ts cleanup
await box.cleanup();
```

## Text

```ts
const box = await makeTmpBox({ git: true });
await box.write("box/questions/Name.question.card", TEXT);

const res = await answer(box, { question: "box/questions/Name.question.card", answer: "Phoenix" });
res.success
=> true

(await box.read("box/questions/Name.question.card")).includes("text: Phoenix")
=> true
```

```ts cleanup
await box.cleanup();
```

## Expired and dismissed are answerable; answered is terminal

An expired question still accepts an answer (expiry demotes visibility, it does
not close the question):

```ts
const box = await makeTmpBox({ git: true });
await box.write("box/questions/Old.question.card", TEXT.replace("status: pending", "status: expired"));

const res = await answer(box, { question: "box/questions/Old.question.card", answer: "Phoenix" });
res.success
=> true
```

```ts cleanup
await box.cleanup();
```

So does a dismissed one (an un-dismissal is the boxholder's prerogative):

```ts
const box = await makeTmpBox({ git: true });
await box.write("box/questions/Skipped.question.card", TEXT.replace("status: pending", "status: dismissed"));

const res = await answer(box, { question: "box/questions/Skipped.question.card", answer: "Phoenix" });
res.success
=> true
```

```ts cleanup
await box.cleanup();
```

An already-answered question is rejected:

```ts
const box = await makeTmpBox({ git: true });
await box.write(
  "box/questions/Done.question.card",
  TEXT.replace("status: pending", "status: answered"),
);

const res = await answer(box, { question: "box/questions/Done.question.card", answer: "Phoenix" });
res.success
=> false

res.error
=> Question is already answered (status: answered); an answered question is terminal
```

```ts cleanup
await box.cleanup();
```

## Single commit — card and job land together

The answered card and its follow-up job are committed in ONE commit, so a
failure can never strand an answered card without its job:

```ts
const box = await makeTmpBox({ git: true });
await box.write("box/questions/Receipt.question.card", SELECT);

await answer(box, { question: "box/questions/Receipt.question.card", answer: "a" });

const files = headFiles(box.root);
files.startsWith("box/jobs/")
=> true

files.includes("box/questions/Receipt.question.card")
=> true

files.split("\n").length
=> 2
```

```ts cleanup
await box.cleanup();
```

## Rollback — a failed commit leaves the question pending and retryable

Because the filesystem writes are not atomic with the commit, a commit failure
must roll back. Here the box has no git repo, so the commit throws; the answer
restores the original card and deletes the job before returning the error:

```ts
const box = await makeTmpBox();
await box.write("box/questions/Receipt.question.card", SELECT);

const res = await answer(box, { question: "box/questions/Receipt.question.card", answer: "a" });
res.success
=> false

res.error.startsWith("Failed to commit transition:")
=> true
```

The card is untouched (still pending) and no job file was left behind:

```ts continue
(await box.read("box/questions/Receipt.question.card")).includes("status: pending")
=> true

(await box.list("box/jobs")).includes(".card")
=> false
```

```ts cleanup
await box.cleanup();
```
