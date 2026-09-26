# `bbx changes`: what changed in the box since a commit

`runChanges(boxRoot, { options, env })` is the command with the box and the
environment given; it prints to stdout and returns the exit code. The
comparison is a tree diff between `--since` and HEAD, so a card added and then
moved inside the window appears once, at its final path, and a card that only
moved is not "added". See docs/plans/notifications.md (Track D).

```ts setup
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { runChanges } from "../../../src/cli/commands/changes.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

const card = (title) => `---\ntitle: ${title}\n---\n${title} body\n`;

/** Run with output captured; returns stdout, stderr lines, and the exit code. */
async function changes(box, options, env = {}) {
  const out = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => { out.push(args.join(" ")); };
  console.error = (...args) => { out.push(`stderr: ${args.join(" ")}`); };
  let code;
  try {
    code = await runChanges(box.root, { options: { match: [], ...options }, env });
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return [...out, `exit ${code}`].join("\n");
}
```

## Three commits add three cards; one of them is moved

Before the window, the box holds an old email and a note. In the window: an
email arrives, then a second email and a memo arrive and the note is edited,
then triage moves the first email (added in the window) and the old one
(added before it) into a folder.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/inbox/old.email.card", card("Old"));
await box.write("_content/notes/plan.memo.card", card("Plan"));
box.commitAll("before the window");
const since = execSync("git rev-parse HEAD", { cwd: box.root }).toString().trim();

await box.write("_content/inbox/trip.email.card", card("Field trip"));
box.commitAll("Intake: trip email");
await box.write("_content/inbox/receipt.email.card", card("Receipt"));
await box.write("_content/notes/groceries.memo.card", card("Groceries"));
await box.write("_content/notes/plan.memo.card", card("Plan, revised"));
box.commitAll("Intake: receipt; groceries note");
execSync("mkdir -p _content/school && git mv _content/inbox/trip.email.card _content/school/ && git mv _content/inbox/old.email.card _content/school/ && git commit -qm 'Triage: file school mail'", { cwd: box.root });
```

By default it lists the paths added since the commit. The moved email appears
once, at its final path; the old email, which only moved, does not.

```ts continue
await changes(box, { since })
=> _content/inbox/receipt.email.card
_content/notes/groceries.memo.card
_content/school/trip.email.card
exit 0
```

`--match` selects by box-relative glob, and may repeat. `--kind modified`
lists edited cards, and `--kind any` everything, the old email's move included.

```ts continue
await changes(box, { since, match: ["_content/**/*.email.card"] })
=> _content/inbox/receipt.email.card
_content/school/trip.email.card
exit 0

await changes(box, { since, match: ["_content/notes/*", "_content/school/*"] })
=> _content/notes/groceries.memo.card
_content/school/trip.email.card
exit 0

await changes(box, { since, kind: "modified" })
=> _content/notes/plan.memo.card
exit 0

await changes(box, { since, kind: "any", match: ["_content/school/*"] })
=> _content/school/old.email.card
_content/school/trip.email.card
exit 0
```

`--cat` prints each card after a `=== <path>` line, so whatever reads the
output keeps the path with the text. `--cat --all` prints every card matching
the globs, changed or not.

```ts continue
await changes(box, { since, match: ["_content/**/*.email.card"], cat: true })
=> === _content/inbox/receipt.email.card
---
title: Receipt
---
Receipt body
=== _content/school/trip.email.card
---
title: Field trip
---
Field trip body
exit 0

(await changes(box, { since, match: ["_content/school/*"], cat: true, all: true })).split("\n").filter((l) => l.startsWith("===")).join("\n")
=> === _content/school/old.email.card
=== _content/school/trip.email.card
```

`--log` prints the commit subjects in the window, oldest first.

```ts continue
await changes(box, { since, log: true })
=> Intake: trip email
Intake: receipt; groceries note
Triage: file school mail
exit 0
```

## `--since` defaults to the schedule's cursor

Inside a scheduled script the tick sets `BBX_SINCE_COMMIT`; outside one, a
missing `--since` exits 2 rather than guessing.

```ts continue
await changes(box, { match: ["_content/notes/*"] }, { BBX_SINCE_COMMIT: since })
=> _content/notes/groceries.memo.card
exit 0

await changes(box, {})
=> stderr: Error: no since: pass --since or run from a schedule
exit 2

await changes(box, { since: "0000000000000000000000000000000000000000" })
=> stderr: Error: could not compare 0000000000000000000000000000000000000000 with HEAD: «*»
exit 1

await changes(box, { since, kind: "renamed" })
=> stderr: Error: --kind must be one of added, modified, any (got "renamed")
exit 2

await changes(box, { since, all: true })
=> stderr: Error: --all applies only with --cat
exit 2
```

## `--or-skip`: nothing changed means exit 75 and a defer marker

With nothing new under the globs, `--or-skip` writes `{ "reason": "no-change" }`
to `$BBX_DEFER_FILE` and exits 75, the procedure skip code. With `--cat --all`
it still keys on whether anything changed, not on what it would print.

```ts continue
const deferDir = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-changes-"));
const BBX_DEFER_FILE = path.join(deferDir, "defer.json");
await changes(box, { match: ["_content/photos/**"], orSkip: true }, { BBX_SINCE_COMMIT: since, BBX_DEFER_FILE })
=> exit 75

await fs.readFile(BBX_DEFER_FILE, "utf-8")
=> {"reason":"no-change"}

await changes(box, { since: "HEAD", match: ["_content/school/*"], cat: true, all: true, orSkip: true })
=> exit 75

await changes(box, { since, match: ["_content/notes/*"], orSkip: true }, { BBX_DEFER_FILE: path.join(deferDir, "second.json") })
=> _content/notes/groceries.memo.card
exit 0

await fs.access(path.join(deferDir, "second.json")).then(() => "written", () => "absent")
=> absent
```

```ts cleanup
await fs.rm(deferDir, { recursive: true, force: true });
await box.cleanup();
```
