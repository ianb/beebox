# A commit a hook rejects is a failure, not a silent no-op

`commit()` returns the new HEAD, and every caller reads that as "the commit
landed". simple-git does not make that safe on its own: when a `pre-commit` or
`commit-msg` hook exits non-zero, `.commit()` **resolves** with an empty result
rather than rejecting. Reading HEAD afterwards then yields the PREVIOUS commit,
which every caller would take as success.

Boxes install both hooks (`bbx validate --staged`, `git annex pre-commit`), so a
rejected commit is an ordinary path, not an exotic one. See
`commitAndReadHead` in `src/lib/git.ts`.

```ts setup
import { execFileSync } from "node:child_process";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { commit, stageAll } from "../../src/lib/git.js";

function git(box, ...args) {
  return execFileSync("git", args, { cwd: box.root }).toString().trim();
}

/** Install a pre-commit hook that always rejects. */
async function installRejectingHook(box) {
  const hookPath = join(git(box, "rev-parse", "--absolute-git-dir"), "hooks", "pre-commit");
  await writeFile(hookPath, "#!/bin/sh\nexit 1\n");
  await chmod(hookPath, 0o755);
}

async function catchName(promise) {
  try { await promise; return "no-throw"; } catch (e) { return e.name; }
}
```

The commit throws, and HEAD is where it was:

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/inbox/Note.memo.card", "---\nstatus: new\n---\nfirst\n");
await box.commitAll("a real commit");
const head = git(box, "rev-parse", "HEAD");

await installRejectingHook(box);
await box.write("_content/inbox/Rejected.memo.card", "---\nstatus: new\n---\nnope\n");
await stageAll(box.root);

JSON.stringify({
  threw: await catchName(commit(box.root, { message: "should not land" })),
  headMoved: git(box, "rev-parse", "HEAD") !== head,
})
=> {"threw":"CommitDidNotLandError","headMoved":false}
```

The changes are still in the tree — a rejected commit loses no work, it just
must not be reported as done:

```ts continue
git(box, "status", "--porcelain").includes("Rejected.memo.card")
=> true
```

With the hook passing again, the same commit lands and returns a new HEAD:

```ts continue
const hookPath = join(git(box, "rev-parse", "--absolute-git-dir"), "hooks", "pre-commit");
await writeFile(hookPath, "#!/bin/sh\nexit 0\n");
const sha = await commit(box.root, { message: "lands this time" });
JSON.stringify({ returnedHead: sha === git(box, "rev-parse", "HEAD"), moved: sha !== head })
=> {"returnedHead":true,"moved":true}
```

```ts cleanup
await box.cleanup();
```
