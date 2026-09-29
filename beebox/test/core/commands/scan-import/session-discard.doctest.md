# A failed import leaves no session behind

The upload ledger records a file's hash only after its import succeeds. An
import that fails after writing its session, and leaves that session in the
box, is imported again in full by the next retry. A promote pass whose commit
failed on every attempt once turned 24 PDFs into 159 staged-but-uncommitted
sessions this way.

So an import that fails before its commit lands removes what it wrote: the
session card, its attach scope, any question cards, and their index entries.
A retry then starts from nothing and produces exactly one session.

Here the box's pre-commit hook refuses the commit, which is how the commit
failed in production (its `bbx validate` could not get admitted).

```ts setup
import { join } from "node:path";
import { chmod, readdir, rm, writeFile } from "node:fs/promises";
import { execa } from "execa";
import Sharp from "sharp";
import { createFakeDocling } from "../../../../src/services/docling/core.js";
import { runPdfMode } from "../../../../src/core/commands/scan-import/pdf.js";
import { runPhotoMode } from "../../../../src/core/commands/scan-import/command.js";
import { createFakeScanVision } from "../../../../src/services/scan-vision.js";
import { createCollectorContext } from "../../../../src/core/command-runner.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { textPdf } from "../../../helpers/pdf-fixtures.js";

async function refuseCommits(box) {
  const { stdout } = await execa("git", ["rev-parse", "--git-path", "hooks"], { cwd: box.root });
  const hook = join(box.root, stdout, "pre-commit");
  await writeFile(hook, "#!/bin/sh\necho 'Work permission has expired' >&2\nexit 1\n");
  await chmod(hook, 0o755);
  return () => rm(hook);
}

async function importPdf(box) {
  const pdfPath = join(box.root, "incoming.pdf");
  await writeFile(pdfPath, textPdf());
  const docling = createFakeDocling({ markdown: "# Scan\n", pageCount: 1, figureCount: 1 });
  const { ctx } = createCollectorContext(box.root);
  return runPdfMode(ctx, { pdfPath, docling }).then((r) => `imported ${String(r.success)}`, (e) => `threw: ${e.message.split("\n")[0]}`);
}

async function sessions(box) {
  const entries = await readdir(join(box.root, "_content/inbox")).catch(() => []);
  return entries.filter((e) => e.startsWith("scan-")).length;
}

async function questions(box) {
  const entries = await readdir(join(box.root, "_bookkeeping/questions")).catch(() => []);
  return entries.filter((e) => e.endsWith(".question.card")).length;
}

async function staged(box) {
  const { stdout } = await execa("git", ["diff", "--cached", "--name-only"], { cwd: box.root });
  return stdout === "" ? "nothing staged" : stdout;
}
```

## A refused PDF commit is discarded, and the retry imports once

```ts
const box = await makeTmpBox({ git: true });
const allowCommits = await refuseCommits(box);
(await importPdf(box)).includes("Work permission has expired")
=> true

`${await sessions(box)} sessions, ${await staged(box)}`
=> 0 sessions, nothing staged
```

A second refused attempt still leaves nothing. Once commits work again, the
import produces one session card and its attach scope.

```ts continue
await importPdf(box);
await sessions(box)
=> 0

await allowCommits();
await importPdf(box)
=> imported true

`${await sessions(box)} entries, ${await staged(box)}`
=> 2 entries, nothing staged
```

```ts cleanup
await box.cleanup();
```

## Question cards written outside the session go too

A photo import whose analysis fails raises one question per page. Those cards
live outside the session, so the discard has to remove them by name.

```ts
const box = await makeTmpBox({ git: true });
await refuseCommits(box);
const imagePaths = [];
for (const i of [0, 1]) {
  const p = join(box.root, `page-${i}.jpg`);
  await Sharp({ create: { width: 32, height: 24, channels: 3, background: { r: i * 60, g: 40, b: 80 } } }).jpeg().toFile(p);
  imagePaths.push(p);
}
const { ctx } = createCollectorContext(box.root);
const vision = createFakeScanVision({ alwaysFailRetry: "batch" });
await runPhotoMode(ctx, { vision, imagePaths, sourcePdfPath: null, extraContext: undefined, source: undefined }).then(
  () => "imported",
  () => "refused",
)
=> refused

`${await sessions(box)} sessions, ${await questions(box)} questions, ${await staged(box)}`
=> 0 sessions, 0 questions, nothing staged
```

```ts cleanup
await box.cleanup();
```
