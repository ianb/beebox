# A fresh box is annex-shaped

`bbx init` produces a box whose assets go to git-annex from its first commit.
Two claims are tested separately, because they fail in different ways:

1. Without the git-annex binary, box creation refuses and creates nothing.
2. With it, a created box annexes real bytes — not a fabricated `.git/annex/`.

The second runs the REAL binary and skips without it. That matters: every
other annex fixture builds its shape with `makeBoxAnnexShaped`, which creates
`.git/annex/objects/` by hand and never runs `git annex`. Those fixtures prove
the ignore block does not block. Only this one proves bytes actually annex —
and "the fixture never ran the real init" is what
`issues/bugs/2026-09-04-scan-import-gitignore-blocks-attach-staging.md` names
as the reason its bug went unnoticed for months.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { requireGitAnnex } from "../../../src/core/annex/require-git-annex.js";
import { annexNewBox } from "../../../src/core/annex/annex-new-box.js";
import { isAnnexBox } from "../../../src/core/annex/is-annex-box.js";
import { createGitAnnexService, createFakeGitAnnex } from "../../../src/services/git-annex.js";
import { scaffoldBoxRoot } from "../../../src/core/box/package.js";

function hasAnnex(): boolean {
  try {
    execFileSync("git", ["annex", "version"], { stdio: "pipe" });
    return true;
  } catch (_e) {
    /* ignore: absence is the answer */
    return false;
  }
}

const ANNEX = hasAnnex();

async function caught(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "(no error)";
  } catch (e) {
    return e instanceof Error ? e.message : "non-error";
  }
}

/** A scaffolded box with a git repo, exactly as `bbx init` has it at the
 * moment `announceAndInitGit` reaches the annex step. */
async function freshBox(tag: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), `bbx-${tag}-`));
  await scaffoldBoxRoot(root);
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: root });
  return root;
}

/** Stage an asset and report how git recorded it: an annex pointer, or raw. */
async function stageAssetAndClassify(root: string): Promise<string> {
  await fs.mkdir(path.join(root, "_content/probe.attach"), { recursive: true });
  await fs.writeFile(path.join(root, "_content/probe.attach/probe.jpg"), Buffer.alloc(4096, 7));
  execFileSync("git", ["add", "_content/probe.attach/probe.jpg"], { cwd: root });
  const blob = execFileSync("git", ["cat-file", "-p", ":_content/probe.attach/probe.jpg"], {
    cwd: root, encoding: "utf8",
  });
  return blob.startsWith("/annex/objects/") ? "annexed" : `NOT annexed: ${blob.slice(0, 40)}`;
}

/** Does git ignore this path? `check-ignore` exits 1 for "not ignored". */
function isIgnored(root: string, relPath: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", relPath], { cwd: root, stdio: "pipe" });
    return true;
  } catch (_e) {
    /* exit 1 means not ignored — the result we want */
    return false;
  }
}

async function realBytesAnnex(): Promise<string> {
  const root = await freshBox("annex-bytes");
  await annexNewBox(createGitAnnexService(), root);
  return stageAssetAndClassify(root);
}

async function shapeFlips(): Promise<string> {
  const root = await freshBox("annex-shape");
  const before = await isAnnexBox(root);
  await annexNewBox(createGitAnnexService(), root);
  const after = await isAnnexBox(root);
  return `before=${String(before)} after=${String(after)}`;
}

async function assetStaysVisible(): Promise<string> {
  const root = await freshBox("annex-ignore");
  await annexNewBox(createGitAnnexService(), root);
  await fs.mkdir(path.join(root, "_content/a.attach"), { recursive: true });
  await fs.writeFile(path.join(root, "_content/a.attach/x.jpg"), Buffer.alloc(16, 1));
  return isIgnored(root, "_content/a.attach/x.jpg") ? "IGNORED" : "visible to git";
}
```

## The preflight refuses when git-annex is absent

`version()` returning null is the service's normal "not installed" answer, not
an error. The refusal names the install line rather than trying to repair:
`bbx init` does not install system packages.

```ts
await caught(() => requireGitAnnex(createFakeGitAnnex({ version: null })))
=>
git-annex is required to create a Bee Box: a box tracks its assets in the annex from its first commit, and without the binary every commit on that box fails. Install it (`apt install git-annex` / `brew install git-annex`).
```

With the binary present it passes silently — routine success is not news.

```ts
await caught(() => requireGitAnnex(createFakeGitAnnex()))
=> (no error)
```

## A created box annexes real bytes

The whole point of the preflight is this box. `annexNewBox` runs the real
`git annex init`, so an asset written afterwards must land in the annex as a
pointer, not as a git blob.

Note what the assertion is: the staged blob starts with `/annex/objects/`.
Asserting that `.git/annex/` exists would pass against a fabricated directory
and prove nothing.

```ts
ANNEX ? await realBytesAnnex() : "annexed"
=> annexed
```

The same box reads as annex-shaped to the probe every asset writer gates on.
`isAnnexBox` reads two independent facts — `.git/annex/` and a `.gitignore`
that no longer hides assets — so this also asserts `annexNewBox` rewrote the
manifest-scheme `.gitignore` that `scaffoldBoxRoot` left behind.

```ts
ANNEX ? await shapeFlips() : "before=false after=true"
=> before=false after=true
```

## The asset bytes are never ignored

The failure this seam keeps having is an ignore rule in a spelling nothing
matches, which hides bytes from git AND the annex with nothing reporting it
(`c47fd2be1` left a production box with 536 such assets). So the check is
`git check-ignore` against a real file, not a reading of the `.gitignore`.

```ts
ANNEX ? await assetStaysVisible() : "visible to git"
=> visible to git
```
