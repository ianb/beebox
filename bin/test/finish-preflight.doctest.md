# finish-preflight: when typecheck and lint may be skipped

Pre-commit typechecks and lints every worktree commit, so `finish-preflight`
skips both when nothing arrived that pre-commit never saw. A merge is such an
arrival: git runs no pre-commit hook on a clean merge.

```ts setup
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = path.resolve(process.cwd(), "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "finish-preflight-"));

const git = (...args: string[]): string =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_MERGE_AUTOEDIT: "no" },
  }).trim();
const write = (file: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
const commit = (file: string, content: string): void => {
  write(file, content);
  git("add", file);
  git("commit", "-qm", `edit ${file}`);
};

const preflight = (): {
  merge: { status: string };
  skipTypecheckLint: { value: boolean; reason: string };
  verification: { command: string; skip?: string }[];
} =>
  JSON.parse(
    execFileSync(process.execPath, ["--import", import.meta.resolve("tsx"), path.join(repo, "bin/finish-preflight.ts"), "--json"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GIT_MERGE_AUTOEDIT: "no" },
    }),
  );
/** The sheet's verdict on `pnpm typecheck`: "runs", or the skip reason. */
const typecheck = (sheet: ReturnType<typeof preflight>): string =>
  sheet.verification.find((c) => c.command === "pnpm typecheck")?.skip ?? "runs";

```

The fixture repo has no workspace packages, so a `bin/` change is verified by
the root scripts, and `pnpm typecheck` is the command to watch.

```ts
git("init", "-q", "-b", "main");
git("config", "user.email", "test@example.com");
git("config", "user.name", "Test");
write("pnpm-workspace.yaml", "packages: []\n");
write("package.json", JSON.stringify({ scripts: { test: "true", typecheck: "true" } }));
git("add", ".");
commit("bin/tool.ts", "export const a = 1;\n");
git("checkout", "-qb", "worktree-demo");
commit("bin/tool.ts", "export const a = 2;\n");
```

## A rerun after a code-bringing merge still verifies

Main gains code after the branch forked. The first preflight run merges it in.
That merged tree has never been typechecked, so the first run must not skip.

```ts continue
git("checkout", "-q", "main");
commit("bin/other.ts", "export const b = 1;\n");
git("checkout", "-q", "worktree-demo");
const first = preflight();
[first.merge.status, first.skipTypecheckLint.value, typecheck(first)]
=> ["merged", false, "runs"]
```

A finish that stops after the first run (a failing test, a human question)
runs preflight again. This run's merge is a no-op, but the tree is the same
unchecked tree. Three finishes in October 2026 skipped typecheck here because
the rule asked only about the current merge.

```ts continue
const second = preflight();
[second.merge.status, second.skipTypecheckLint.value, typecheck(second)]
=> ["up-to-date", false, "runs"]
```

The reason names the earlier merge, so a reader can find the commit.

```ts continue
const mergeSha = git("log", "--merges", "-1", "--format=%H").slice(0, 9);
assert.match(second.skipTypecheckLint.reason, new RegExp(`merge ${mergeSha}`));
```

## A merge that brought only docs keeps the skip

Docs reach no typecheck or lint, so a branch whose only merge brought
Markdown skips both, on the first run and on every rerun.

```ts continue
git("checkout", "-q", "-b", "worktree-docs", "main");
commit("bin/docs-branch.ts", "export const c = 1;\n");
git("checkout", "-q", "main");
commit("notes/readme.md", "# notes\n");
git("checkout", "-q", "worktree-docs");
const docsFirst = preflight();
const docsSecond = preflight();
[docsFirst.skipTypecheckLint.value, docsSecond.skipTypecheckLint.value, typecheck(docsSecond)]
=> [true, true, "no merge on this branch brought code; pre-commit covered every commit"]
```

## Arguments

`--help` prints the usage. It must not merge main: main gains a commit here,
and the branch head must stay where it was. An unknown flag exits 2 for the
same reason.

```ts continue
git("checkout", "-q", "main");
commit("notes/later.md", "# later\n");
git("checkout", "-q", "worktree-docs");
const before = git("rev-parse", "HEAD");
const cli = (arg: string) =>
  spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), path.join(repo, "bin/finish-preflight.ts"), arg], {
    cwd: root,
    encoding: "utf8",
  });
const help = cli("--help");
const unknown = cli("--jsno");
[help.status, help.stdout.split("\n")[0], unknown.status, git("rev-list", "--count", `${before}..HEAD`)]
=> [0, "usage: bin/finish-preflight [--json] [--no-merge]", 2, "0"]
```

```ts teardown
fs.rmSync(root, { recursive: true, force: true });
```
